import { Badge } from "@marmalade-v2/ui/components/badge";
import { Button } from "@marmalade-v2/ui/components/button";
import { Input } from "@marmalade-v2/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { AdminNav, relativeTime } from "@/components/admin-nav";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin/audit")({
  component: AuditRoute,
});

const STATUSES = ["success", "rejected", "accepted", "failed", "dead"] as const;

function statusVariant(status: string) {
  if (status === "rejected" || status === "failed" || status === "dead") {
    return "destructive" as const;
  }
  if (status === "success") return "default" as const;
  return "secondary" as const;
}

function AuditRoute() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [resource, setResource] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const audit = useQuery(
    orpc.admin.auditLog.queryOptions({
      input: {
        status,
        resource: resource.trim() === "" ? undefined : resource.trim(),
        limit: 100,
      },
    }),
  );

  return (
    <div className="space-y-4 p-4">
      <AdminNav />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={status === undefined ? "default" : "outline"}
          onClick={() => setStatus(undefined)}
        >
          all
        </Button>
        {STATUSES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={status === option ? "default" : "outline"}
            onClick={() => setStatus(option)}
          >
            {option}
          </Button>
        ))}
        <Input
          className="max-w-48"
          placeholder="resource, e.g. jelly_action"
          value={resource}
          onChange={(event) => setResource(event.target.value)}
        />
      </div>

      <p className="text-muted-foreground text-sm">
        Rejected entries are recorded alongside successful ones: a write refused
        for a missing scope is usually more interesting than one that went
        through.
      </p>

      {audit.isPending && <Loader2 className="animate-spin" />}

      <ul className="space-y-1">
        {audit.data?.map((entry) => (
          <li key={entry.id} className="rounded border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(entry.status)}>
                {entry.status}
              </Badge>
              <span className="font-medium">{entry.action}</span>
              <span className="text-muted-foreground">
                {entry.resource}
                {entry.resourceId !== "-1" && `/${entry.resourceId}`}
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {entry.userName ??
                  (entry.apiKeyName
                    ? `key "${entry.apiKeyName}"`
                    : "system")}{" "}
                · {relativeTime(entry.timestamp)}
              </span>
            </div>

            {(entry.changes != null || entry.metadata != null) && (
              <button
                type="button"
                className="text-muted-foreground mt-1 text-xs underline"
                onClick={() =>
                  setExpanded(expanded === entry.id ? null : entry.id)
                }
              >
                {expanded === entry.id ? "hide detail" : "detail"}
              </button>
            )}

            {expanded === entry.id && (
              <pre className="bg-muted mt-1 overflow-x-auto rounded p-2 text-xs">
                {JSON.stringify(
                  { changes: entry.changes, metadata: entry.metadata },
                  null,
                  2,
                )}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
