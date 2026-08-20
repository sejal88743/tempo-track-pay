import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TABS = ["Employees", "Attendance", "Salary", "Leaves", "Advances", "Tempos"] as const;

function getApiKeysOptional() {
  const lovable = process.env.LOVABLE_API_KEY;
  const key = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovable || !key) {
    return null;
  }
  return { lovable, key };
}

function getApiKeys() {
  const keys = getApiKeysOptional();
  if (!keys) {
    throw new Error(
      "Google Sheets integration is not configured. LOVABLE_API_KEY and GOOGLE_SHEETS_API_KEY are required.",
    );
  }
  return keys;
}

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

function authHeaders() {
  const { lovable, key } = getApiKeys();
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": key,
    "Content-Type": "application/json",
  };
}

async function gw(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: init?.method ?? "GET",
    headers: authHeaders(),
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export const createMasterSpreadsheet = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ title: z.string().min(1).max(200).default("Transport Staff") }).parse(d),
  )
  .handler(async ({ data }) => {
    const result = await gw("/spreadsheets", {
      method: "POST",
      body: {
        properties: { title: data.title },
        sheets: TABS.map((t) => ({ properties: { title: t } })),
      },
    });
    const spreadsheetId = result.spreadsheetId as string;
    await gw(`/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: {
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: "Employees!A1:I1",
            values: [
              [
                "ID",
                "Name",
                "Role",
                "Monthly Salary",
                "Joining",
                "Mobile",
                "Active",
                "Fingerprint",
                "Face",
              ],
            ],
          },
          {
            range: "Attendance!A1:I1",
            values: [
              ["ID", "Employee ID", "Name", "Date", "Shift", "Status", "In", "Out", "Method"],
            ],
          },
          {
            range: "Salary!A1:P1",
            values: [
              [
                "ID",
                "Employee ID",
                "Name",
                "Month",
                "Days",
                "Present",
                "Absent",
                "Paid Leave",
                "Unpaid",
                "Per Day",
                "Gross",
                "Advance",
                "Leave Deduct",
                "Bonus",
                "Penalty",
                "Final",
              ],
            ],
          },
          {
            range: "Leaves!A1:H1",
            values: [["ID", "Employee ID", "Name", "Type", "From", "To", "Reason", "Status"]],
          },
          {
            range: "Advances!A1:H1",
            values: [
              ["ID", "Employee ID", "Name", "Amount", "Reason", "Date", "Status", "Deducted"],
            ],
          },
          {
            range: "Tempos!A1:C1",
            values: [["ID", "Vehicle Number", "Active"]],
          },
        ],
      },
    });
    return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` };
  });

const syncSchema = z.object({
  spreadsheetId: z.string().min(10).max(200),
  tab: z.enum(TABS),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(10000),
});

export const syncTabToSheet = createServerFn({ method: "POST" })
  .inputValidator((d) => syncSchema.parse(d))
  .handler(async ({ data }) => {
    const keys = getApiKeysOptional();
    if (!keys) {
      return { ok: false, count: 0, skipped: true, reason: "Sheets API not configured" };
    }
    await gw(`/spreadsheets/${data.spreadsheetId}/values/${data.tab}!A2:Z:clear`, {
      method: "POST",
      body: {},
    });
    if (!data.rows.length) return { ok: true, count: 0 };
    const endCol = String.fromCharCode(64 + Math.min(data.rows[0].length, 26));
    await gw(
      `/spreadsheets/${data.spreadsheetId}/values/${data.tab}!A2:${endCol}${data.rows.length + 1}?valueInputOption=USER_ENTERED`,
      { method: "PUT", body: { values: data.rows } },
    );
    return { ok: true, count: data.rows.length };
  });
