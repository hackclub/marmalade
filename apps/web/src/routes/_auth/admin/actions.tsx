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
import { useState } from "react";
import { toast } from "sonner";

import { AdminNav, relativeTime } from "@/components/admin-nav";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/admin/actions")({
  component: ActionsRoute,
});

const STATUSES = [
  "pending",
  "awaiting_approval",
  "scheduled",
  "in_flight",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
] as const;

function statusVariant(status: string) {
  if (status === "dead" || status === "failed") return "destructive" as const;
  if (status === "succeeded") return "default" as const;
  return "secondary" as const;
}

function ActionsRoute() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);

  const actions = useQuery({
    ...orpc.admin.actions.queryOptions({ input: { status, limit: 100 } }),
    refetchInterval: 20_000,
  });

  const control = useMutation(
    orpc.admin.actionControl.mutationOptions({
      onSuccess: (result) => {
        toast.success(`${result.message} (now ${result.status})`);
        actions.refetch();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const requeueDead = useMutation(
    orpc.admin.requeueDeadLetters.mutationOptions({
      onSuccess: (result) => {
        toast.success(`Requeued ${result.requeued} dead letter(s)`);
        actions.refetch();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="space-y-4 p-4">
      <AdminNav />

      <div className="flex flex-wrap items-center gap-1">
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
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={requeueDead.isPending}
          onClick={() => requeueDead.mutate({})}
        >
          {requeueDead.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            "Requeue all dead letters"
          )}
        </Button>
      </div>

      {actions.isPending && <Loader2 className="animate-spin" />}

      {actions.data?.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No actions match this filter.
        </p>
      )}

      <div className="space-y-2">
        {actions.data?.map((action) => (
          <Card key={action.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(action.status)}>
                  {action.status}
                </Badge>
                <CardTitle className="text-base">{action.actionType}</CardTitle>
                <span className="text-muted-foreground font-mono text-xs">
                  {action.id}
                </span>
              </div>
              <CardDescription>
                {action.apiKeyName
                  ? `key "${action.apiKeyName}"`
                  : (action.userName ?? action.actorKey)}{" "}
                · {relativeTime(action.createdAt)} · attempt {action.attempts}/
                {action.maxAttempts}
                {action.targetResourceId && (
                  <> · target {action.targetResourceId}</>
                )}
                {action.jellyMailboxId && (
                  <> · mailbox {action.jellyMailboxId}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {action.lastError != null && (
                <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                  {JSON.stringify(action.lastError, null, 2)}
                </pre>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setExpanded(expanded === action.id ? null : action.id)
                  }
                >
                  {expanded === action.id ? "Hide payload" : "Show payload"}
                </Button>

                {action.status === "awaiting_approval" && (
                  <Button
                    size="sm"
                    disabled={control.isPending}
                    onClick={() =>
                      control.mutate({
                        actionId: action.id,
                        operation: "approve",
                      })
                    }
                  >
                    Approve
                  </Button>
                )}

                {["failed", "dead", "cancelled"].includes(action.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={control.isPending}
                    onClick={() =>
                      control.mutate({
                        actionId: action.id,
                        operation: "retry",
                      })
                    }
                  >
                    Retry
                  </Button>
                )}

                {["pending", "scheduled", "awaiting_approval"].includes(
                  action.status,
                ) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={control.isPending}
                    onClick={() =>
                      control.mutate({
                        actionId: action.id,
                        operation: "cancel",
                        reason: "Cancelled from the admin queue",
                      })
                    }
                  >
                    Cancel
                  </Button>
                )}

                {["pending", "scheduled", "in_flight"].includes(
                  action.status,
                ) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={control.isPending}
                    onClick={() =>
                      control.mutate({
                        actionId: action.id,
                        operation: "force_fail",
                        reason: "Force-failed from the admin queue",
                      })
                    }
                  >
                    Force fail
                  </Button>
                )}
              </div>

              {expanded === action.id && (
                <div className="space-y-2">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Payload sent
                    </p>
                    <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                      {JSON.stringify(action.payload, null, 2)}
                    </pre>
                  </div>
                  {action.jellyResponse != null && (
                    <div>
                      <p className="text-muted-foreground text-xs">
                        Jelly response
                      </p>
                      <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                        {JSON.stringify(action.jellyResponse, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
