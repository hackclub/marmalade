import { Badge } from "@marmalade-v2/ui/components/badge";
import { Button } from "@marmalade-v2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marmalade-v2/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AdminNav, duration, relativeTime } from "@/components/admin-nav";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin/dashboard")({
  component: HealthRoute,
});

function Gauge({
  label,
  used,
  ceiling,
  footnote,
}: {
  label: string;
  used: number;
  ceiling: number;
  footnote: string;
}) {
  const pct = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 0;
  const tone =
    pct >= 90 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums">
          {used.toLocaleString()} / {ceiling.toLocaleString()}
        </span>
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted-foreground text-xs">{footnote}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const color =
    tone === "bad"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-xl font-medium tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function HealthRoute() {
  const health = useQuery({
    ...orpc.admin.health.queryOptions(),
    // An operator watching this page during an incident wants it live.
    refetchInterval: 15_000,
  });

  const drain = useMutation(
    orpc.admin.drainNow.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          `Drained ${result.claimed} action(s): ${result.succeeded} succeeded, ${result.retried} requeued, ${result.failed} failed`,
        );
        health.refetch();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (health.isPending) {
    return (
      <div className="p-4">
        <AdminNav />
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const data = health.data;
  if (!data) return null;

  const oldestPending = data.queue.oldestPendingAgeMs;

  return (
    <div className="space-y-4 p-4">
      <AdminNav />

      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, index) => (
            <div
              key={index}
              className={`rounded-md border p-3 text-sm ${
                alert.severity === "critical"
                  ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              }`}
            >
              <Badge
                variant={
                  alert.severity === "critical" ? "destructive" : "secondary"
                }
                className="mr-2"
              >
                {alert.severity}
              </Badge>
              {alert.message}
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Action queue</CardTitle>
          <CardDescription>
            Oldest pending age is the number to watch. If it climbs, something
            is wrong regardless of what else looks fine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label="Oldest pending"
              value={oldestPending ? duration(oldestPending) : "—"}
              tone={
                oldestPending && oldestPending > 15 * 60 * 1000
                  ? "warn"
                  : undefined
              }
            />
            <Stat label="In flight" value={String(data.queue.inFlight)} />
            <Stat
              label="Dead letters"
              value={String(data.queue.deadLetters)}
              tone={data.queue.deadLetters > 0 ? "bad" : undefined}
            />
            <Stat
              label="Awaiting approval"
              value={String(data.queue.awaitingApproval)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.queue.counts).map(([status, count]) => (
              <Badge key={status} variant="outline">
                {status}: {count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Worker</CardTitle>
          <CardDescription>
            Drains the queue once a minute via Vercel cron. A stalled worker
            means writes are accepted but never reach Jelly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={data.worker.stalled ? "destructive" : "default"}>
              {data.worker.stalled ? "stalled" : "healthy"}
            </Badge>
            <span className="text-muted-foreground text-sm">
              last run {relativeTime(data.worker.lastRunAt)}, claimed{" "}
              {data.worker.lastClaimedCount} in{" "}
              {duration(data.worker.lastDurationMs)}
            </span>
          </div>
          {data.worker.lastError && (
            <p className="bg-muted rounded p-2 font-mono text-xs">
              {data.worker.lastError}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={drain.isPending}
            onClick={() => drain.mutate({ limit: 25 })}
          >
            {drain.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              "Drain now"
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jelly quota</CardTitle>
          <CardDescription>
            Jelly allows {data.quota.day.jellyLimit.toLocaleString()} requests
            per day and {data.quota.fiveMinute.jellyLimit.toLocaleString()} per
            five minutes. Marmalade stops short of both so manual use and other
            integrations still have room.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Gauge
            label="Today"
            used={data.quota.day.used}
            ceiling={data.quota.day.ceiling}
            footnote={`Worker share ${data.quota.day.workerCeiling.toLocaleString()} · resets ${new Date(data.quota.day.resetsAt).toUTCString()}`}
          />
          <Gauge
            label="Last 5 minutes"
            used={data.quota.fiveMinute.used}
            ceiling={data.quota.fiveMinute.ceiling}
            footnote={`Resets ${relativeTime(data.quota.fiveMinute.resetsAt)
              .replace("ago", "")
              .trim()} from now`}
          />
          <div className="flex items-center gap-2 text-sm">
            <Badge
              variant={
                data.quota.circuit.pausedUntil &&
                new Date(data.quota.circuit.pausedUntil) > new Date()
                  ? "destructive"
                  : "outline"
              }
            >
              circuit{" "}
              {data.quota.circuit.pausedUntil &&
              new Date(data.quota.circuit.pausedUntil) > new Date()
                ? "open"
                : "closed"}
            </Badge>
            <span className="text-muted-foreground">
              {data.quota.circuit.consecutiveFailures} consecutive failures ·
              last success {relativeTime(data.quota.circuit.lastSuccessAt)}
            </span>
          </div>
          {data.quota.circuit.pausedReason && (
            <p className="text-muted-foreground text-xs">
              {data.quota.circuit.pausedReason}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>
            Jelly does not retry a failed delivery and deactivates the webhook
            after {data.webhooks.limit} consecutive failures. Reads keep working
            from a mirror that has silently stopped updating, so this is the
            failure most likely to go unnoticed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={data.webhooks.atRisk ? "destructive" : "default"}>
              {data.webhooks.consecutiveFailures} / {data.webhooks.limit}{" "}
              consecutive failures
            </Badge>
          </div>
          <ul className="space-y-1 text-sm">
            {data.webhooks.events.map((event) => (
              <li
                key={event.event}
                className="flex justify-between rounded border px-2 py-1"
              >
                <span className="font-mono text-xs">{event.event}</span>
                <span className="text-muted-foreground">
                  last {relativeTime(event.lastReceivedAt)} ·{" "}
                  {event.received24h} in 24h
                  {event.failures24h > 0 && (
                    <span className="text-red-600">
                      {" "}
                      · {event.failures24h} failed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
