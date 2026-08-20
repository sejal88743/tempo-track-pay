import { defineMcp } from "@lovable.dev/mcp-js";
import appInfoTool from "./tools/app-info";
import todayAdminPasswordTool from "./tools/today-admin-password";

export default defineMcp({
  name: "transport-staff-mcp",
  title: "Transport Staff Attendance MCP",
  version: "0.1.0",
  instructions:
    "Read-only tools describing this Transport Staff Attendance & Salary app. Employee, attendance, and salary data are stored in each admin's browser (localStorage) and are not accessible from these tools.",
  tools: [appInfoTool, todayAdminPasswordTool],
});
