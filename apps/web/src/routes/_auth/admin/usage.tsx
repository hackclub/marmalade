import { Badge } from "@marmalade-v2/ui/components/badge";
import { Button } from "@marmalade-v2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marmalade-v2/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { AdminNav } from "@/components/admin-nav";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin/usage")({
  component: UsageRoute,
});

const WINDOWS = ["1h", "24h", "7d", "30d"] as const;
const SCOPES = ["api_key", "user", "team"] as const;

function errorRate(requests: number, errors: number): string {
  if (requests === 0) return "0%";
  return `${((errors / requests) * 100).toFixed(1)}%`;
}

function UsageRoute() {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>("24h");
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("api_key");

  const usage = useQuery(
    orpc.admin.usage.queryOptions({ input: { window, scope } }),
  );

  return (
    <div className="space-y-4 p-4">
      <AdminNav />

      <div className="flex flex-wrap gap-4">
        <div className="flex gap-1">
          {WINDOWS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={window === option ? "default" : "outline"}
              onClick={() => setWindow(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {SCOPES.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={scope === option ? "default" : "outline"}
              onClick={() => setScope(option)}
            >
              {option.replace("_", " ")}
            </Button>
          ))}
        </div>
      </div>

      {usage.isPending && <Loader2 className="animate-spin" />}

      {usage.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Top consumers</CardTitle>
              <CardDescription>
                Who is about to get the team rate-limited. Read from hourly
                rollups, so the 30-day window costs about what the 1-hour one
                does.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usage.data.consumers.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No Jelly traffic recorded in this window. Rollups are written
                  hourly, so very recent activity appears on the next pass.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="pb-1">Consumer</th>
                      <th className="pb-1 text-right">Requests</th>
                      <th className="pb-1 text-right">Errors</th>
                      <th className="pb-1 text-right">429s</th>
                      <th className="pb-1 text-right">p50</th>
                      <th className="pb-1 text-right">p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.data.consumers.map((consumer) => (
                      <tr key={consumer.scopeId} className="border-t">
                        <td className="py-1">{consumer.label}</td>
                        <td className="py-1 text-right tabular-nums">
                          {consumer.requests.toLocaleString()}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {consumer.errors} (
                          {errorRate(consumer.requests, consumer.errors)})
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {consumer.throttled}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {consumer.p50Ms ?? "—"}ms
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {consumer.p95Ms ?? "—"}ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Endpoints</CardTitle>
              <CardDescription>
                Jelly paths with resource ids collapsed, so rows group by
                endpoint rather than fragmenting per conversation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {usage.data.endpoints.slice(0, 25).map((endpoint) => (
                  <li
                    key={endpoint.dimension}
                    className="flex justify-between rounded border px-2 py-1"
                  >
                    <span className="font-mono text-xs">
                      {endpoint.dimension}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {endpoint.requests.toLocaleString()} req ·{" "}
                      {endpoint.errors} err · p95 {endpoint.p95Ms ?? "—"}ms
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions submitted</CardTitle>
              <CardDescription>
                Write actions created in this window, by type and current state.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {usage.data.actions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No write actions in this window.
                </p>
              ) : (
                usage.data.actions.map((action) => (
                  <Badge
                    key={`${action.actionType}:${action.status}`}
                    variant={
                      action.status === "dead" || action.status === "failed"
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {action.actionType} · {action.status} · {action.count}
                  </Badge>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
