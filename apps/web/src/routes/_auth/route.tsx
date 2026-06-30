import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async () => {
    const session = await getUser();
    const teamMember = await orpc.membershipInfo.call(undefined);

    if (!session) {
      throw redirect({
        to: "/login",
      });
    }

    if (!teamMember) {
      throw redirect({
        to: "/login",
      });
    }

    return { session, teamMember };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({
        to: "/login",
      });
    }
  },
});

function AuthLayout() {
  return <Outlet />;
}
