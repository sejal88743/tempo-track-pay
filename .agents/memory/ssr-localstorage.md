---
name: SSR localStorage/sessionStorage Guard
description: localStorage and sessionStorage are undefined during SSR; need browser check
---

TanStack Start (and similar SSR frameworks) execute route loaders and component code on the server before hydration. `localStorage` and `sessionStorage` do not exist in Node.js/server context.

**Fix:** Add `typeof window !== "undefined"` guard before any storage access:

```ts
const isBrowser = typeof window !== "undefined";

export function isAdminLoggedIn(): boolean {
  if (!isBrowser) return false;
  return sessionStorage.getItem("tsa_admin") === "1";
}
```

**Why:** Without the guard, SSR throws `ReferenceError: sessionStorage is not defined` which renders the entire route as a 500 error.

**How to apply:** Every function in store.ts that reads/writes localStorage or sessionStorage must check `isBrowser` first. The fallback should be the empty/false/default value so SSR renders the login redirect state.
