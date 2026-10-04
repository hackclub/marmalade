import { Badge } from "@marmalade-v2/ui/components/badge";
import { Button } from "@marmalade-v2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marmalade-v2/ui/components/card";
import { Input } from "@marmalade-v2/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth/admin/users")({
  component: UsersRoute,
});

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | string | null;
  createdAt: Date | string;
};

function UsersRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [banReason, setBanReason] = useState<Record<string, string>>({});

  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const result = await authClient.admin.listUsers({
        query: { limit: 200, sortBy: "createdAt", sortDirection: "desc" },
      });
      if (result.error) throw new Error(result.error.message);
      return (result.data?.users ?? []) as AdminUser[];
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });

  // Better Auth's client resolves with `{ data, error }` instead of throwing,
  // so every action unwraps the same way.
  const run =
    (label: string, fn: () => Promise<{ error?: unknown }>) => async () => {
      const result = await fn();
      const error = result.error as { message?: string } | undefined;
      if (error) {
        toast.error(error.message ?? `${label} failed`);
        return;
      }
      toast.success(label);
      refresh();
    };

  const isAdmin =
    (session?.user as { role?: string } | undefined)?.role === "admin";

  const impersonating = (
    session?.session as { impersonatedBy?: string } | undefined
  )?.impersonatedBy;

  if (users.isPending) {
    return (
      <div className="p-4">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (users.error) {
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">Could not load users</p>
        <p className="text-muted-foreground text-sm">{users.error.message}</p>
        <p className="text-muted-foreground text-sm">
          This page is for Marmalade instance admins. A Jelly team admin role
          does not grant it.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-10">
      {impersonating && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
          <span>
            You are impersonating <strong>{session?.user.email}</strong>.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={run("Stopped impersonating", async () => {
              const r = await authClient.admin.stopImpersonating();
              if (!r.error) navigate({ to: "/admin/users" });
              return r;
            })}
          >
            Stop
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Marmalade users</CardTitle>
          <CardDescription>
            Instance administration — who can sign in and act as whom. This is
            separate from a Jelly team role: being a team owner in Jelly does
            not make someone an admin here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {users.data?.map((user) => {
              const self = user.id === session?.user.id;
              return (
                <li key={user.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={user.banned ? "line-through" : ""}>
                      {user.name}
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {user.email}
                    </span>
                    <Badge
                      variant={user.role === "admin" ? "default" : "outline"}
                    >
                      {user.role ?? "user"}
                    </Badge>
                    {user.banned && (
                      <Badge variant="destructive">
                        banned{user.banReason ? `: ${user.banReason}` : ""}
                      </Badge>
                    )}
                    {self && <Badge variant="secondary">you</Badge>}
                  </div>

                  {isAdmin && !self && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {user.banned ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={run("User unbanned", () =>
                            authClient.admin.unbanUser({ userId: user.id }),
                          )}
                        >
                          Unban
                        </Button>
                      ) : (
                        <>
                          <Input
                            className="max-w-56"
                            placeholder="reason (optional)"
                            value={banReason[user.id] ?? ""}
                            onChange={(event) =>
                              setBanReason((prev) => ({
                                ...prev,
                                [user.id]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={run("User banned", () =>
                              authClient.admin.banUser({
                                userId: user.id,
                                banReason: banReason[user.id] || undefined,
                              }),
                            )}
                          >
                            Ban
                          </Button>
                        </>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={run(
                          `Impersonating ${user.email}`,
                          async () => {
                            const r = await authClient.admin.impersonateUser({
                              userId: user.id,
                            });
                            if (!r.error) navigate({ to: "/" });
                            return r;
                          },
                        )}
                      >
                        Impersonate
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={run(
                          user.role === "admin"
                            ? "Demoted to user"
                            : "Promoted to admin",
                          () =>
                            authClient.admin.setRole({
                              userId: user.id,
                              role: user.role === "admin" ? "user" : "admin",
                            }),
                        )}
                      >
                        {user.role === "admin" ? "Demote" : "Make admin"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={run("Sessions revoked", () =>
                          authClient.admin.revokeUserSessions({
                            userId: user.id,
                          }),
                        )}
                      >
                        Revoke sessions
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {!isAdmin && (
            <p className="text-muted-foreground mt-3 text-sm">
              You are not a Marmalade instance admin, so these users are
              read-only.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
