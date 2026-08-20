import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "app_info",
  title: "App info",
  description:
    "Return basic info about this Transport Staff Attendance & Salary app. Data itself lives in each admin's browser (localStorage), so tools here do not read employee, attendance or salary records.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: "Transport Staff Attendance & Salary",
            storage: "browser-localStorage (per admin device)",
            features: [
              "Employees",
              "Attendance (manual, fingerprint, face)",
              "Tempo assignments",
              "Leaves",
              "Advances",
              "Salary calculation",
              "Optional Google Sheets sync",
            ],
          },
          null,
          2,
        ),
      },
    ],
  }),
});
