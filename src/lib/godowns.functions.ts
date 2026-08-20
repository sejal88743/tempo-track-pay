import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ensureAdmin = async () => {
  const { requireAdmin } = await import("./session.server");
  await requireAdmin();
};

export const listGodowns = createServerFn({ method: "GET" }).handler(async () => {
  await ensureAdmin();
  const { query } = await import("@/integrations/supabase/client.server");
  return query(`SELECT * FROM godowns ORDER BY name`);
});

const godownSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  radius_meters: z.number().int().min(10).max(10000).default(100),
  active: z.boolean().default(true),
});

export const upsertGodown = createServerFn({ method: "POST" })
  .inputValidator((d) => godownSchema.parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { queryOne } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      return queryOne(
        `UPDATE godowns SET name=$1, address=$2, latitude=$3, longitude=$4, radius_meters=$5, active=$6
         WHERE id=$7 RETURNING *`,
        [
          data.name,
          data.address ?? null,
          data.latitude ?? null,
          data.longitude ?? null,
          data.radius_meters,
          data.active,
          data.id,
        ],
      );
    } else {
      return queryOne(
        `INSERT INTO godowns (name, address, latitude, longitude, radius_meters, active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          data.name,
          data.address ?? null,
          data.latitude ?? null,
          data.longitude ?? null,
          data.radius_meters,
          data.active,
        ],
      );
    }
  });

export const deleteGodown = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await ensureAdmin();
    const { execute } = await import("@/integrations/supabase/client.server");
    await execute(`DELETE FROM godowns WHERE id = $1`, [data.id]);
    return { ok: true };
  });
