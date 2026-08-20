import { createFileRoute, redirect } from "@tanstack/react-router";
import { setAdminLoggedIn } from "@/lib/store";

export const Route = createFileRoute("/logout")({
  loader: () => {
    if (typeof window !== "undefined") setAdminLoggedIn(false);
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
