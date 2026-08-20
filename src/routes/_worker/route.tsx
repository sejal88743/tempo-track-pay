import { createFileRoute, redirect } from "@tanstack/react-router";

// Old _worker layout is no longer used.
// Workers now go to /worker (src/routes/worker.tsx)
export const Route = createFileRoute("/_worker")({
  loader: () => {
    throw redirect({ to: "/worker" });
  },
  component: () => null,
});
