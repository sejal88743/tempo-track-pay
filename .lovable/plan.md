# Cloud Data Setup Plan

Ab tak app data har admin ke browser ke `localStorage` me tha (memory: `localStorage-only architecture`). Aap chahte hain sab kuch cloud me permanent rahe, face data har worker ke saath save ho, aur multiple devices se workers apne apne phone se GPS location par attendance mark kar saken. Iske liye pura data layer Supabase par shift karna hoga.

## Kya banega

1. **Database migration** (Supabase tables already hain, unhe use karne layak banayenge)
   - `employees` me add: `face_descriptor float8[]`, `credential_ids text[]`, `biometric_enrolled boolean`, `extra_roles text[]`
   - `attendance` me add: `device_id text`, `latitude float8`, `longitude float8`, `accuracy_meters float8`, `location_ok boolean`, `method text` (manual/fingerprint/face)
   - `settings` table already hai — key/value JSON
   - Public API access: har table par `GRANT SELECT, INSERT, UPDATE, DELETE TO anon` + open RLS policies. **Reason:** app me real Supabase auth nahi hai (admin login = DDMM+MANOJ formula, worker = face/fingerprint). Isliye Data API anonymous open rahegi. Ye trade-off aap accept kar rahe hain — koi bhi jisko URL mile wo API call kar sakta hai.

2. **Nayi cloud store layer** (`src/lib/cloud-store.ts`)
   - `getEmployees()`, `upsertEmployee()`, `getAttendance()`, `upsertAttendance()`, etc. — sab async, Supabase se
   - Real-time subscription: employees/attendance me change ho to sab devices auto refresh (`supabase.channel().on('postgres_changes')`)
   - Har device ek unique `device_id` generate karke localStorage me rakhega (sirf identifier)
   - Settings bhi cloud me — `settings` table key/value se

3. **Worker face flow** (multi-device)
   - Face descriptor `employees.face_descriptor` column me save (worker enrollment ke waqt)
   - Kisi bhi device se worker apna face scan kare → sab workers ke descriptors cloud se load hote hain → match hote hi attendance insert
   - Har attendance row me device_id + GPS coords save

4. **GPS enforcement**
   - Settings me office location (lat/lng/radius) admin set kare
   - Worker device se attendance ke waqt geolocation liya jaye, radius ke bahar ho to block
   - Coords aur "location_ok" attendance row me save

5. **Components refactor** — sab pages jo `getEmployees()`, `getAttendance()` etc. call karte hain, unhe React Query ke through async cloud store se data fetch karayenge (`useQuery` + `useMutation`). Files:
   - `src/routes/_admin/employees.tsx`, `attendance.tsx`, `salary.tsx`, `leaves.tsx`, `advances.tsx`, `dashboard.tsx`, `tempos.tsx`, `assignments.tsx`, `settings.tsx`, `reports.tsx`
   - `src/routes/worker.tsx`, `src/routes/_worker/my.tsx`
   - `src/components/QuickAttendance.tsx`, `BiometricEnrollDialog.tsx`

6. **One-time migration helper** — Settings me button "Import local data to cloud" — agar admin ke browser me pehle se local data hai to cloud me push kar de.

7. **Google Sheets sync** existing rahega, ab cloud data ko sync karega.

## Technical notes

- Client uses browser Supabase client (`@/integrations/supabase/client`, publishable key). No server functions needed.
- Realtime channel per table for cross-device sync.
- Face-api.js descriptor is a `Float32Array` of 128 numbers — stored as `float8[]`.
- `device_id` = `crypto.randomUUID()` cached in `localStorage` (only identifier, not data).
- Migration will DROP existing incompatible policies and add open ones — one-way.

## Scope note

Ye kaafi bada change hai — approve karenge to main step-by-step banaunga: pehle migration + cloud-store + settings/employees screen, phir baaki screens. Approve karein to shuru karun?
