import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

function todayDDMM_IST() {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}${mm}`;
}

export default defineTool({
  name: "today_admin_password_hint",
  title: "Today's admin password formula",
  description:
    "Explain today's admin password formula (DDMM + secret word) and today's DDMM prefix in IST. Does not reveal the secret word.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [
      {
        type: "text",
        text: `Admin password = DDMM + SECRET (IST). Today's DDMM prefix: ${todayDDMM_IST()}. Default secret is "MANOJ" unless the admin changed it in Settings.`,
      },
    ],
  }),
});
