import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAdminLoggedIn } from "@/lib/store";

export const Route = createFileRoute("/")({
  loader: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
