import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  broadcastDataChange,
  getDataRevision,
  query as dbQuery,
  queryOne as dbQueryOne,
  execute as dbExecute,
  subscribeToDataChanges,
} from "@/integrations/supabase/client.server";
import { getSession } from "@/lib/session.server";

const collections = ["employees", "attendance", "leaves", "advances", "salaries", "tempos", "settings"] as const;
type Collection = (typeof collections)[number];

const mutationSchema = z.object({
  operation: z.enum(["upsert", "delete"]),
  collection: z.enum(collections),
  payload: z.unknown().optional(),
  id: z.string().uuid().optional(),
});

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function snapshot() {
  const session = await getSession();
  const isAdmin = session?.role === "admin";
  const [employees, attendance, leaves, advances, salaries, tempos, settings] = await Promise.all([
    dbQuery(`SELECT * FROM employees ${isAdmin ? "" : "WHERE active = true"} ORDER BY created_at DESC`),
    dbQuery(`SELECT * FROM attendance ORDER BY attendance_date DESC LIMIT 20000`),
    isAdmin ? dbQuery(`SELECT * FROM leaves ORDER BY created_at DESC`) : Promise.resolve([]),
    isAdmin ? dbQuery(`SELECT * FROM advances ORDER BY created_at DESC`) : Promise.resolve([]),
    isAdmin ? dbQuery(`SELECT * FROM salaries ORDER BY generated_at DESC`) : Promise.resolve([]),
    isAdmin ? dbQuery(`SELECT * FROM tempos ORDER BY created_at DESC`) : Promise.resolve([]),
    dbQuery(`SELECT key, value FROM settings WHERE key IN ('app_settings', 'admin_secret_word')`),
  ]);

  const settingsMap = Object.fromEntries(settings.map((row) => [row.key, row.value]));
  const appSettings =
    settingsMap.app_settings && typeof settingsMap.app_settings === "object"
      ? { ...(settingsMap.app_settings as Record<string, unknown>) }
      : {};
  if (!isAdmin) delete appSettings.admin_secret;
  if (isAdmin && typeof settingsMap.admin_secret_word === "string") {
    appSettings.admin_secret = settingsMap.admin_secret_word;
  }

  return {
    revision: getDataRevision(),
    employees,
    attendance,
    leaves,
    advances,
    salaries,
    tempos,
    settings: appSettings,
  };
}

async function canWrite(collection: Collection, payload: unknown) {
  const session = await getSession();
  if (session?.role === "admin") return true;
  if (collection === "attendance") return true;

  // The worker portal may register a face for an existing employee, but it
  // cannot create/edit employee payroll or identity data.
  if (collection === "employees" && payload && typeof payload === "object" && "id" in payload) {
    const row = await dbQueryOne<{ id: string }>("SELECT id FROM employees WHERE id = $1", [
      (payload as { id: string }).id,
    ]);
    return !!row;
  }
  return false;
}

async function upsert(collection: Collection, payload: unknown) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid sync payload.");
  const row = payload as Record<string, unknown>;

  if (collection === "employees") {
    const roles = Array.isArray(row.roles) ? row.roles.map(String) : [];
    const extras = Array.isArray(row.extra_roles) ? row.extra_roles.map(String) : [];
    const credentials = Array.isArray(row.credential_ids) ? row.credential_ids.map(String) : [];
    const existing = row.id
      ? await dbQueryOne("SELECT id FROM employees WHERE id = $1", [row.id])
      : null;
    if (existing) {
      return dbQueryOne(
        `UPDATE employees SET employee_code=$1, full_name=$2, mobile_number=$3, joining_date=$4,
         roles=$5, extra_roles=$6, monthly_salary=$7, active=$8, biometric_enrolled=$9,
         credential_ids=$10, face_descriptor=$11 WHERE id=$12 RETURNING *`,
        [
          String(row.employee_code ?? ""),
          String(row.full_name ?? ""),
          row.mobile_number ?? null,
          row.joining_date ?? null,
          roles,
          extras,
          Number(row.monthly_salary ?? 0),
          row.active !== false,
          !!row.biometric_enrolled,
          credentials,
          Array.isArray(row.face_descriptor) ? row.face_descriptor.map(Number) : null,
          row.id,
        ],
      );
    }
    return dbQueryOne(
      `INSERT INTO employees
       (id, employee_code, full_name, mobile_number, joining_date, roles, extra_roles,
        monthly_salary, active, biometric_enrolled, credential_ids, face_descriptor)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,COALESCE($5,current_date),$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        row.id ?? null,
        String(row.employee_code ?? ""),
        String(row.full_name ?? ""),
        row.mobile_number ?? null,
        row.joining_date ?? null,
        roles,
        extras,
        Number(row.monthly_salary ?? 0),
        row.active !== false,
        !!row.biometric_enrolled,
        credentials,
        Array.isArray(row.face_descriptor) ? row.face_descriptor.map(Number) : null,
      ],
    );
  }

  if (collection === "attendance") {
    return dbQueryOne(
      `INSERT INTO attendance
       (id, employee_id, attendance_date, shift, status, in_time, out_time, location_ok, method,
        marked_by, device_id, latitude, longitude, accuracy_meters, daily_salary_override)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (employee_id, attendance_date, shift) DO UPDATE SET
        status=EXCLUDED.status, in_time=EXCLUDED.in_time, out_time=EXCLUDED.out_time,
        location_ok=EXCLUDED.location_ok, method=EXCLUDED.method, marked_by=EXCLUDED.marked_by,
        device_id=EXCLUDED.device_id, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
        accuracy_meters=EXCLUDED.accuracy_meters, daily_salary_override=EXCLUDED.daily_salary_override
       RETURNING *`,
      [
        row.id ?? null, row.employee_id, row.attendance_date, row.shift ?? "morning", row.status ?? "present",
        row.in_time ?? null, row.out_time ?? null, row.location_ok ?? null, row.method ?? "manual",
        row.marked_by ?? "admin", row.device_id ?? null, row.latitude ?? null, row.longitude ?? null,
        row.accuracy_meters ?? null, row.daily_salary_override ?? null,
      ],
    );
  }

  if (collection === "leaves") {
    return dbQueryOne(
      `INSERT INTO leaves (id, employee_id, leave_type, from_date, to_date, reason, status)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET employee_id=EXCLUDED.employee_id, leave_type=EXCLUDED.leave_type,
       from_date=EXCLUDED.from_date, to_date=EXCLUDED.to_date, reason=EXCLUDED.reason, status=EXCLUDED.status
       RETURNING *`,
      [row.id ?? null, row.employee_id, row.leave_type ?? row.type ?? "casual", row.from_date, row.to_date, row.reason ?? null, row.status ?? "pending"],
    );
  }

  if (collection === "advances") {
    return dbQueryOne(
      `INSERT INTO advances (id, employee_id, amount, reason, taken_on, status, deducted, deducted_in_month)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET employee_id=EXCLUDED.employee_id, amount=EXCLUDED.amount,
       reason=EXCLUDED.reason, taken_on=EXCLUDED.taken_on, status=EXCLUDED.status,
       deducted=EXCLUDED.deducted, deducted_in_month=EXCLUDED.deducted_in_month RETURNING *`,
      [row.id ?? null, row.employee_id, Number(row.amount ?? 0), row.reason ?? null, row.taken_on ?? row.date, row.status ?? "pending", !!row.deducted, row.deducted_in_month ?? row.deducted_month ?? null],
    );
  }

  if (collection === "salaries") {
    return dbQueryOne(
      `INSERT INTO salaries
       (id, employee_id, month, total_days, present_days, absent_days, paid_leave_days, unpaid_leave_days,
        per_day, gross, advance_deducted, leave_deduction, bonus, penalty, final_salary)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (employee_id, month) DO UPDATE SET total_days=EXCLUDED.total_days,
       present_days=EXCLUDED.present_days, absent_days=EXCLUDED.absent_days,
       paid_leave_days=EXCLUDED.paid_leave_days, unpaid_leave_days=EXCLUDED.unpaid_leave_days,
       per_day=EXCLUDED.per_day, gross=EXCLUDED.gross, advance_deducted=EXCLUDED.advance_deducted,
       leave_deduction=EXCLUDED.leave_deduction, bonus=EXCLUDED.bonus, penalty=EXCLUDED.penalty,
       final_salary=EXCLUDED.final_salary RETURNING *`,
      [row.id ?? null, row.employee_id, row.month, Number(row.total_days ?? 0), Number(row.present_days ?? 0),
        Number(row.absent_days ?? 0), Number(row.paid_leave_days ?? 0), Number(row.unpaid_leave_days ?? 0),
        Number(row.per_day ?? 0), Number(row.gross ?? 0), Number(row.advance_deducted ?? 0),
        Number(row.leave_deduction ?? 0), Number(row.bonus ?? 0), Number(row.penalty ?? 0), Number(row.final_salary ?? 0)],
    );
  }

  if (collection === "tempos") {
    return dbQueryOne(
      `INSERT INTO tempos (id, vehicle_number, active)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3)
       ON CONFLICT (id) DO UPDATE SET vehicle_number=EXCLUDED.vehicle_number, active=EXCLUDED.active
       RETURNING *`,
      [row.id ?? null, row.vehicle_number, row.active !== false],
    );
  }

  return dbQueryOne(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now() RETURNING *`,
    [row.key ?? "app_settings", JSON.stringify(row.value ?? row)],
  );
}

async function handleMutation(request: Request) {
  const parsed = mutationSchema.safeParse(await request.json());
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid request.");
  const { operation, collection, payload, id } = parsed.data;
  if (!(await canWrite(collection, payload))) return jsonError("UNAUTHORIZED", 401);

  if (operation === "delete") {
    if (!id) return jsonError("Delete id is required.");
    const existing = await dbQueryOne<Record<string, unknown>>(`SELECT * FROM ${collection} WHERE id = $1`, [id]);
    await dbExecute(`DELETE FROM ${collection} WHERE id = $1`, [id]);
    broadcastDataChange({ table: collection, eventType: "DELETE", row: existing });
    return Response.json({ data: null });
  }

  const result = await upsert(collection, payload);
  broadcastDataChange({ table: collection, eventType: "UPDATE", row: result });
  return Response.json({ data: result });
}

function streamResponse() {
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // The browser already closed the connection.
        }
      };
      unsubscribe = subscribeToDataChanges((change) => send({ ...change, revision: getDataRevision() }));
      send({ type: "ready", revision: getDataRevision() });
      heartbeat = setInterval(() => send({ type: "heartbeat", revision: getDataRevision() }), 25_000);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export const Route = createFileRoute("/api/sync")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (new URL(request.url).searchParams.get("stream") === "1") return streamResponse();
        return Response.json(await snapshot());
      },
      POST: ({ request }) => handleMutation(request),
    },
  },
});