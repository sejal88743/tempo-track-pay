import { createFileRoute, redirect } from "@tanstack/react-router";

// Redirect to new worker page
export const Route = createFileRoute("/_worker/my")({
  loader: () => {
    throw redirect({ to: "/worker" });
  },
  component: () => null,
});
