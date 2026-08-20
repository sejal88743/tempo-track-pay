/* eslint-disable @typescript-eslint/no-explicit-any */
// Google Sheets sync via OAuth2 (GAPI)
// All calls are client-side only

import {
  getSettings,
  updateSettings,
  getEmployees,
  getAttendance,
  getSalaries,
  getLeaves,
  getAdvances,
  getTempos,
} from "./store";

const DISCOVERY_DOC = "https://sheets.googleapis.com/$discovery/rest?version=v4";
const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let gapiInited = false;
let gisInited = false;
let tokenClient: any = null;

export function loadGapiScript(): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById("gapi-script")) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = "gapi-script";
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => {
      window.gapi.load("client", async () => {
        await window.gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        gapiInited = true;
        resolve();
      });
    };
    document.head.appendChild(s);
  });
}

export function loadGisScript(clientId: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById("gis-script")) {
      gisInited = true;
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = "gis-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: "",
      });
      gisInited = true;
      resolve();
    };
    document.head.appendChild(s);
  });
}

export async function authorizeGoogle(clientId: string): Promise<string> {
  if (!gapiInited) await loadGapiScript();
  if (!gisInited) await loadGisScript(clientId);
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp: any) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      const token = window.gapi.client.getToken();
      updateSettings({
        google_access_token: token.access_token,
        google_token_expiry: Date.now() + token.expires_in * 1000,
      });
      resolve(token.access_token);
    };
    if (window.gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClient.requestAccessToken({ prompt: "" });
    }
  });
}

export function isGoogleAuthorized(): boolean {
  const s = getSettings();
  return !!(s.google_access_token && s.google_token_expiry && s.google_token_expiry > Date.now());
}

// ---------- sheet helpers ----------

async function ensureToken() {
  if (!gapiInited) await loadGapiScript();
  const s = getSettings();
  if (!s.google_access_token)
    throw new Error("Google account connect nahi hai. Settings me connect karein.");
  window.gapi.client.setToken({ access_token: s.google_access_token });
}

export async function createSpreadsheet(title = "Transport Staff Attendance"): Promise<string> {
  await ensureToken();
  const resp = await window.gapi.client.sheets.spreadsheets.create({
    resource: {
      properties: { title },
      sheets: [
        { properties: { title: "Employees" } },
        { properties: { title: "Attendance" } },
        { properties: { title: "Salary" } },
        { properties: { title: "Leaves" } },
        { properties: { title: "Advances" } },
        { properties: { title: "Tempos" } },
      ],
    },
  });
  const id: string = resp.result.spreadsheetId;
  updateSettings({ spreadsheet_id: id });

  // Write headers
  await writeHeaders(id);
  return id;
}

async function writeHeaders(spreadsheetId: string) {
  await window.gapi.client.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "Employees!A1:H1",
          values: [
            [
              "ID",
              "Name",
              "Role",
              "Monthly Salary",
              "Joining Date",
              "Mobile",
              "Active",
              "Biometric Enrolled",
            ],
          ],
        },
        {
          range: "Attendance!A1:I1",
          values: [
            [
              "ID",
              "Employee ID",
              "Employee Name",
              "Date",
              "Shift",
              "Status",
              "In Time",
              "Out Time",
              "Location OK",
            ],
          ],
        },
        {
          range: "Salary!A1:O1",
          values: [
            [
              "ID",
              "Employee ID",
              "Name",
              "Month",
              "Total Days",
              "Present",
              "Absent",
              "Paid Leave",
              "Unpaid Leave",
              "Per Day (₹)",
              "Gross (₹)",
              "Advance Deducted (₹)",
              "Leave Deduction (₹)",
              "Bonus (₹)",
              "Penalty (₹)",
              "Final Salary (₹)",
            ],
          ],
        },
        {
          range: "Leaves!A1:H1",
          values: [
            ["ID", "Employee ID", "Employee Name", "Type", "From", "To", "Reason", "Status"],
          ],
        },
        {
          range: "Advances!A1:H1",
          values: [
            [
              "ID",
              "Employee ID",
              "Employee Name",
              "Amount (₹)",
              "Reason",
              "Date",
              "Status",
              "Deducted",
            ],
          ],
        },
        {
          range: "Tempos!A1:C1",
          values: [["ID", "Vehicle Number", "Active"]],
        },
      ],
    },
  });
}

export async function syncToSheets(): Promise<void> {
  await ensureToken();
  const s = getSettings();
  if (!s.spreadsheet_id) throw new Error("No spreadsheet selected. Create or link one first.");

  const emps = getEmployees();
  const empMap = new Map(emps.map((e) => [e.id, e.full_name]));
  const att = getAttendance();
  const salaries = getSalaries();
  const leaves = getLeaves();
  const advances = getAdvances();
  const tempos = getTempos();

  const empRows = emps.map((e) => [
    e.id,
    e.full_name,
    e.role,
    e.monthly_salary,
    e.joining_date,
    e.mobile,
    e.active ? "Yes" : "No",
    e.biometric_enrolled ? "Yes" : "No",
  ]);
  const attRows = att.map((r) => [
    r.id,
    r.employee_id,
    empMap.get(r.employee_id) ?? "",
    r.date,
    r.shift,
    r.status,
    r.in_time ?? "",
    r.out_time ?? "",
    r.location_ok ? "Yes" : "No",
  ]);
  const salRows = salaries.map((r) => [
    r.id,
    r.employee_id,
    empMap.get(r.employee_id) ?? "",
    r.month,
    r.total_days,
    r.present_days,
    r.absent_days,
    r.paid_leave_days,
    r.unpaid_leave_days,
    r.per_day,
    r.gross,
    r.advance_deducted,
    r.leave_deduction,
    r.bonus,
    r.penalty,
    r.final_salary,
  ]);
  const leaveRows = leaves.map((l) => [
    l.id,
    l.employee_id,
    empMap.get(l.employee_id) ?? "",
    l.type,
    l.from_date,
    l.to_date,
    l.reason,
    l.status,
  ]);
  const advRows = advances.map((a) => [
    a.id,
    a.employee_id,
    empMap.get(a.employee_id) ?? "",
    a.amount,
    a.reason,
    a.date,
    a.status,
    a.deducted ? "Yes" : "No",
  ]);
  const tempoRows = tempos.map((t) => [t.id, t.vehicle_number, t.active ? "Yes" : "No"]);

  const data = [];
  if (empRows.length) data.push({ range: `Employees!A2:H${empRows.length + 1}`, values: empRows });
  if (attRows.length) data.push({ range: `Attendance!A2:I${attRows.length + 1}`, values: attRows });
  if (salRows.length) data.push({ range: `Salary!A2:P${salRows.length + 1}`, values: salRows });
  if (leaveRows.length)
    data.push({ range: `Leaves!A2:H${leaveRows.length + 1}`, values: leaveRows });
  if (advRows.length) data.push({ range: `Advances!A2:H${advRows.length + 1}`, values: advRows });
  if (tempoRows.length)
    data.push({ range: `Tempos!A2:C${tempoRows.length + 1}`, values: tempoRows });

  if (!data.length) return;

  await window.gapi.client.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: s.spreadsheet_id,
    resource: { valueInputOption: "USER_ENTERED", data },
  });

  updateSettings({ last_synced: new Date().toISOString() });
}
