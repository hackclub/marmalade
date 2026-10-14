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
import { Label } from "@marmalade-v2/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin/")({
  component: AdminRoute,
});

type OnboardForm = {
  id: string;
  slug: string;
  name: string;
  token: string;
  webhookSecret: string;
  apiBaseUrl: string;
};

const EMPTY_FORM: OnboardForm = {
  id: "",
  slug: "",
  name: "",
  token: "",
  webhookSecret: "",
  apiBaseUrl: "",
};

/**
 * Instance operation: the Jelly teams this deployment serves.
 *
 * Separate from `/admin/team`, which is the caller's own team. Everything
 * here is about Marmalade rather than about any one team, so it is gated on
 * being an instance operator and not on holding any Jelly role.
 */
function AdminRoute() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OnboardForm>(EMPTY_FORM);
  /**
   * The test result, and the exact inputs it was produced from.
   *
   * Keyed to the inputs rather than a boolean so that editing the token or
   * the base URL after a passing test invalidates it. A stale pass is worse
   * than no test: it says "checked" about something that was not.
   */
  const [tested, setTested] = useState<{
    token: string;
    apiBaseUrl: string;
    memberCount: number;
    mailboxCount: number;
    mailboxes: string[];
  } | null>(null);
  const [issued, setIssued] = useState<{
    slug: string;
    webhookUrl: string;
    webhookSecret: string;
    generated: boolean;
  } | null>(null);

  const mine = useQuery(orpc.team.listMine.queryOptions());
  const isOperator = mine.data?.isInstanceOperator ?? false;

  // Team admins get the audit log for their own team and nothing else here;
  // the team list and the onboarding form are instance operation.
  const teams = useQuery({
    ...orpc.instance.listTeams.queryOptions(),
    enabled: isOperator,
  });

  const audit = useQuery(orpc.audit.list.queryOptions());

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["instance"] });

  const test = useMutation(
    orpc.instance.testConnection.mutationOptions({
      onSuccess: (result, variables) => {
        setTested({
          token: variables.token,
          apiBaseUrl: variables.apiBaseUrl ?? "",
          memberCount: result.memberCount,
          mailboxCount: result.mailboxCount,
          mailboxes: result.mailboxes,
        });
        toast.success(
          `Jelly answered: ${result.memberCount} members, ${result.mailboxCount} mailboxes`,
        );
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
        setIssued({
          slug: result.team.slug,
          webhookUrl: result.team.webhookUrl,
          webhookSecret: result.webhookSecret,
          generated: result.webhookSecretGenerated,
        });
        setForm(EMPTY_FORM);
        setTested(null);
        toast.success(
          `${result.team.name ?? result.team.slug} connected — ${
            result.memberCount
          } members synced`,
        );
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

  if (teams.isPending) {
    return (
      <div className="p-4">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (teams.error) {
    return (
      <div className="space-y-2 p-4">
        <p className="font-medium">Could not load teams</p>
        <p className="text-muted-foreground text-sm">{teams.error.message}</p>
        <p className="text-muted-foreground text-sm">
          This page is for Marmalade instance operators. Being an admin or owner
          of a Jelly team does not grant it.
        </p>
      </div>
    );
  }

  const field = (key: keyof OnboardForm) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      // Any edit to what was tested retires the result.
      if (key === "token" || key === "apiBaseUrl") setTested(null);
      setForm((previous) => ({ ...previous, [key]: event.target.value }));
    },
  });

  const testMatchesForm =
    tested !== null &&
    tested.token === form.token.trim() &&
    tested.apiBaseUrl === form.apiBaseUrl.trim();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            What has been done in{" "}
            <strong>{mine.data?.activeSlug ?? "this team"}</strong>. Scoped to
            the selected team, so switching teams changes what is listed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.isPending ? (
            <Loader2 className="animate-spin" />
          ) : audit.error ? (
            <p className="text-muted-foreground text-sm">
              {audit.error.message}
            </p>
          ) : audit.data?.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing recorded for this team yet.
            </p>
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
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-2 border-b py-1 last:border-0"
                  >
                    <code className="text-xs">
                      {new Date(entry.timestamp).toISOString()}
                    </code>
                    <Badge variant="outline">{entry.action}</Badge>
                    <span>{entry.resource}</span>
                    <span className="text-muted-foreground text-xs">
                      {entry.resourceId}
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

      {!isOperator ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connected Jelly teams</CardTitle>
              <CardDescription>
                Every team this deployment serves. Switch between them with the
                team selector in the header.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {teams.data?.map((team) => (
                  <li key={team.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {team.name ?? team.slug}
                      </span>
                      <code className="text-muted-foreground text-xs">
                        {team.slug}
                      </code>
                      {!team.active && (
                        <Badge variant="destructive">inactive</Badge>
                      )}
                      {!team.hasApiToken && (
                        <Badge variant="destructive">no api token</Badge>
                      )}
                      {!team.hasWebhookSecret && (
                        <Badge variant="destructive">no webhook secret</Badge>
                      )}
                      {/*
                       * Until a delivery verifies, the mirror is one-way — and a
                       * webhook configured wrongly in Jelly looks exactly like a
                       * quiet inbox. Say which it is.
                       */}
                      {team.firstWebhookAt ? (
                        <Badge variant="secondary">receiving webhooks</Badge>
                      ) : (
                        <Badge variant="outline">
                          waiting for first webhook
                        </Badge>
                      )}
                    </div>

                    <p className="text-muted-foreground mt-2 text-xs break-all">
                      {team.webhookUrl}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setActive.isPending}
                        onClick={() =>
                          setActive.mutate({
                            id: team.id,
                            active: !team.active,
                          })
                        }
                      >
                        {team.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {issued && (
            <Card className="border-amber-300">
              <CardHeader>
                <CardTitle>Finish the Jelly side</CardTitle>
                <CardDescription>
                  {issued.generated
                    ? "Shown once. Paste both into Jelly under Settings → Integrations."
                    : "Stored the secret you supplied. Point the Jelly webhook at this URL."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <Label>Webhook URL</Label>
                  <p className="font-mono text-xs break-all">
                    {issued.webhookUrl}
                  </p>
                </div>
                {issued.generated && (
                  <div>
                    <Label>Signing secret</Label>
                    <p className="font-mono text-xs break-all">
                      {issued.webhookSecret}
                    </p>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIssued(null)}
                >
                  Done
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Connect a team</CardTitle>
              <CardDescription>
                The token is checked against Jelly before anything is stored, so
                a team cannot end up connected with a credential that does not
                work.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="team-id">Jelly team id</Label>
                  <Input
                    id="team-id"
                    placeholder="hack-club"
                    {...field("id")}
                  />
                </div>
                <div>
                  <Label htmlFor="team-slug">Slug</Label>
                  <Input
                    id="team-slug"
                    placeholder="defaults to the name"
                    {...field("slug")}
                  />
                </div>
                <div>
                  <Label htmlFor="team-name">Display name</Label>
                  <Input
                    id="team-name"
                    placeholder="Hack Club"
                    {...field("name")}
                  />
                </div>
                <div>
                  <Label htmlFor="team-base">API base URL</Label>
                  <Input
                    id="team-base"
                    placeholder="https://app.letsjelly.com"
                    {...field("apiBaseUrl")}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="team-token">Jelly API token</Label>
                <Input id="team-token" type="password" {...field("token")} />
              </div>

              <div>
                <Label htmlFor="team-secret">Webhook signing secret</Label>
                <Input
                  id="team-secret"
                  type="password"
                  placeholder="leave blank to generate one"
                  {...field("webhookSecret")}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Jelly generates a secret when a webhook is created. Paste
                  theirs if the webhook already exists; otherwise Marmalade
                  issues one.
                </p>
              </div>

              {testMatchesForm && (
                <div className="rounded-md border border-emerald-300 p-3 text-sm">
                  <p className="font-medium">Jelly answered</p>
                  <p className="text-muted-foreground">
                    {tested.memberCount} members, {tested.mailboxCount}{" "}
                    mailboxes
                    {tested.mailboxes.length > 0 &&
                      `: ${tested.mailboxes.slice(0, 8).join(", ")}`}
                    {tested.mailboxes.length > 8 && ", …"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Check this is the team you meant before connecting it.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={!form.token || test.isPending}
                  onClick={() =>
                    test.mutate({
                      token: form.token.trim(),
                      apiBaseUrl: form.apiBaseUrl.trim() || undefined,
                    })
                  }
                >
                  {test.isPending ? "Asking Jelly…" : "Test connection"}
                </Button>

                {/*
              Required, not advisory. Connecting a team writes credentials,
              a slug and a webhook secret, and starts a sync — all against
              whichever team the token actually belongs to, which is the one
              thing the form cannot tell you.
            */}
                <Button
                  disabled={!form.id || !testMatchesForm || onboard.isPending}
                  onClick={() =>
                    onboard.mutate({
                      id: form.id.trim(),
                      slug: form.slug.trim() || undefined,
                      name: form.name.trim() || undefined,
                      token: form.token.trim(),
                      webhookSecret: form.webhookSecret.trim() || undefined,
                      apiBaseUrl: form.apiBaseUrl.trim() || undefined,
                    })
                  }
                >
                  {onboard.isPending ? "Connecting…" : "Connect team"}
                </Button>

                {!testMatchesForm && (
                  <span className="text-muted-foreground text-xs">
                    {tested
                      ? "The token changed — test it again."
                      : "Test the connection first."}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
