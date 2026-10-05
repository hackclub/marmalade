import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

import { orpc } from "@/utils/orpc";

const PENDING_STATUSES = ["pending", "scheduled", "awaiting_approval"];

function tone(status: string): string {
  if (status === "succeeded") return "text-green-600";
  if (status === "failed" || status === "dead") return "text-red-600";
  return "text-amber-600";
}

/**
 * Write actions this account has submitted, and what became of them.
 *
 * This is the screen that only exists because writes go through a durable
 * queue: an action made offline or during a rate-limit window is visible as
 * pending with a reason, and survives the app being closed.
 */
export default function OutboxScreen() {
  const actions = useQuery({
    ...orpc.action.list.queryOptions({ input: { limit: 50 } }),
    refetchInterval: 15_000,
  });

  const cancel = useMutation(
    orpc.action.cancel.mutationOptions({
      onSuccess: () => actions.refetch(),
      onError: (error) => Alert.alert("Could not cancel", error.message),
    }),
  );

  const retry = useMutation(
    orpc.action.retry.mutationOptions({
      onSuccess: () => actions.refetch(),
      onError: (error) => Alert.alert("Could not retry", error.message),
    }),
  );

  if (actions.isPending) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      className="bg-background flex-1"
      contentContainerClassName="p-4 gap-2"
      data={actions.data ?? []}
      keyExtractor={(item) => item.id}
      refreshing={actions.isFetching}
      onRefresh={() => actions.refetch()}
      ListEmptyComponent={
        <Text className="text-muted-foreground text-center">
          Nothing queued. Write actions appear here while they are pending,
          retrying or scheduled.
        </Text>
      }
      renderItem={({ item }) => {
        const error = item.lastError as { message?: string } | null;
        return (
          <View className="border-border gap-1 rounded-lg border p-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-foreground font-semibold">
                {item.actionType}
              </Text>
              <Text className={tone(item.status)}>{item.status}</Text>
            </View>

            <Text className="text-muted-foreground">
              attempt {item.attempts}/{item.maxAttempts}
              {item.targetResourceId ? ` · ${item.targetResourceId}` : ""}
            </Text>

            {error?.message && (
              <Text className="text-red-600">{error.message}</Text>
            )}

            <View className="flex-row gap-2 pt-1">
              {PENDING_STATUSES.includes(item.status) && (
                <Pressable
                  onPress={() =>
                    cancel.mutate({
                      actionId: item.id,
                      reason: "Cancelled from the mobile outbox",
                    })
                  }
                  className="border-border rounded border px-3 py-1"
                >
                  <Text className="text-foreground">Cancel</Text>
                </Pressable>
              )}
              {["failed", "dead", "cancelled"].includes(item.status) && (
                <Pressable
                  onPress={() => retry.mutate({ actionId: item.id })}
                  className="border-border rounded border px-3 py-1"
                >
                  <Text className="text-foreground">Retry</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      }}
    />
  );
}
