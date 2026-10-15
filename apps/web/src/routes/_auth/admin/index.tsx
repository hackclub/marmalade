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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin/")({
  component: AdminRoute,
});

const EMPTY = { id: "", slug: "", name: "", token: "", webhookSecret: "" };

function AdminRoute() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [tested, setTested] = useState<{
    token: string;
    summary: string;
  } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const mine = useQuery(orpc.team.listMine.queryOptions());
  const isOperator = mine.data?.isInstanceOperator ?? false;

  const audit = useQuery(orpc.audit.list.queryOptions());
  const teams = useQuery({
    ...orpc.instance.listTeams.queryOptions(),
    enabled: isOperator,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["instance"] });

  const test = useMutation(
    orpc.instance.testConnection.mutationOptions({
      onSuccess: (result, variables) => {
        setTested({
          token: variables.token,
          summary: `${result.memberCount} members, ${result.mailboxCount} mailboxes`,
        });
      },
      onError: (error) => {
        setTested(null);
        toast.error(error.message);
      },
    }),
  );

  const onboard = useMutation(
    orpc.instance.onboardTeam.mutationOptions({
      onSuccess: (result) => {
        setSecret(result.webhookSecretGenerated ? result.webhookSecret : null);
        setForm(EMPTY);
        setTested(null);
        toast.success(`${result.team.slug} connected`);
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const setActive = useMutation(
    orpc.instance.setTeamActive.mutationOptions({
      onSuccess: (result) => {
        toast.success(result.message);
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (mine.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Tying the pass to the token it was produced from, so editing the token
  // after testing puts the button back to disabled.
  const ready = tested !== null && tested.token === form.token.trim();

  const field = (key: keyof typeof form, placeholder: string) => ({
    placeholder,
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (key === "token") setTested(null);
      setForm((previous) => ({ ...previous, [key]: event.target.value }));
    },
  });

  return (
    <div className="mx-auto w-full max-w-md space-y-4 py-10">
      {isOperator && (
        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {teams.data?.map((team) => (
              <div key={team.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{team.name ?? team.slug}</span>
                  <code className="text-muted-foreground text-xs">
                    {team.slug}
                  </code>
                  {!team.active && (
                    <Badge variant="destructive">inactive</Badge>
                  )}
                  {!team.firstWebhookAt && (
                    <Badge variant="outline">no webhook yet</Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 text-xs break-all">
                  {team.webhookUrl}
                </p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={setActive.isPending}
                  onClick={() =>
                    setActive.mutate({ id: team.id, active: !team.active })
                  }
                >
                  {team.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isOperator && (
        <Card>
          <CardHeader>
            <CardTitle>Connect a team</CardTitle>
            <CardDescription>
              The token is checked against Jelly before anything is stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input {...field("id", "Jelly team id")} />
            <Input {...field("name", "Name")} />
            <Input {...field("slug", "Slug")} />
            <Input type="password" {...field("token", "API token")} />
            <Input
              type="password"
              {...field("webhookSecret", "Webhook secret, if Jelly made one")}
            />

            {ready && (
              <p className="text-muted-foreground text-sm">
                Jelly answered: {tested.summary}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!form.token || test.isPending}
                onClick={() => test.mutate({ token: form.token.trim() })}
              >
                {test.isPending ? "Testing" : "Test"}
              </Button>
              <Button
                disabled={!form.id || !ready || onboard.isPending}
                onClick={() =>
                  onboard.mutate({
                    id: form.id.trim(),
                    slug: form.slug.trim() || undefined,
                    name: form.name.trim() || undefined,
                    token: form.token.trim(),
                    webhookSecret: form.webhookSecret.trim() || undefined,
                  })
                }
              >
                Connect
              </Button>
            </div>

            {secret && (
              <p className="text-sm">
                Paste this into Jelly, it is not shown again:{" "}
                <code className="break-all">{secret}</code>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Audit</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.isPending ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : audit.data?.length === 0 ? (
            <p className="py-4 text-center">Nothing recorded for this team.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {audit.data
                ?.slice()
                .sort(
                  (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime(),
                )
                .slice(0, 100)
                .map((entry) => (
                  <li key={entry.id} className="flex items-baseline gap-2">
                    <span className="text-muted-foreground text-xs">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                    <span>
                      {entry.action} {entry.resource}
                    </span>
                    {entry.status !== "success" && (
                      <Badge variant="destructive">{entry.status}</Badge>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
