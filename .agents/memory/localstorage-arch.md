---
name: localStorage-only Architecture (No Supabase)
description: This project stores all data in localStorage; no database; biometric credential IDs stored per employee
---

All application data lives in browser localStorage under `tsa_*` keys:

- `tsa_employees`, `tsa_attendance`, `tsa_leaves`, `tsa_advances`, `tsa_salaries`, `tsa_tempos`, `tsa_settings`, `tsa_assignments`

Admin session is in `sessionStorage` key `tsa_admin = "1"`.

**Worker auth:** No passwords. Workers select their name → biometric scan (WebAuthn). First scan = enroll (credential ID saved to employee record). Subsequent scans = verify using stored credential ID.

**Admin auth:** Date-based password: DDMM + SECRET (SECRET stored in settings, default "MANOJ").

**Google Sheets sync:** Optional. User provides OAuth Client ID, authorizes, creates/links spreadsheet. `syncToSheets()` pushes all data. No auto-sync — manual button in Settings.

**Why:** User explicitly wanted no Supabase, pure client-side, works offline, data owned by admin's device.

**How to apply:** Never add server functions or database calls. All CRUD goes through `src/lib/store.ts` helper functions.
