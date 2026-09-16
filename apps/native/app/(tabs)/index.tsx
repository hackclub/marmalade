import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import { orpc } from "@/utils/orpc";

/**
 * Mailboxes the signed-in member can reach.
 *
 * This is the end-to-end smoke test for the stack: session cookie forwarded
 * from SecureStore, oRPC over the RPC link, mailbox scoping applied server
 * side. If this renders, everything underneath it works.
 */
export default function MailboxesScreen() {
  const mailboxes = useQuery(orpc.mailbox.list.queryOptions());

  if (mailboxes.isPending) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (mailboxes.error) {
    return (
      <View className="bg-background flex-1 items-center justify-center gap-2 p-6">
        <Text className="text-foreground text-center">
          Could not load mailboxes
        </Text>
        <Text className="text-muted-foreground text-center">
          {mailboxes.error.message}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="bg-background flex-1"
      contentContainerClassName="p-4 gap-2"
      data={mailboxes.data ?? []}
      keyExtractor={(item) => item.jellyMailbox.jellyMailboxId}
      ListEmptyComponent={
        <Text className="text-muted-foreground text-center">
          No mailboxes are shared with this account yet.
        </Text>
      }
      renderItem={({ item }) => {
        const managed = item.marmaladeMailbox;
        return (
          <View className="border-border gap-1 rounded-lg border p-3">
            <Text className="text-foreground text-base font-semibold">
              {item.jellyMailbox.name}
            </Text>
            <Text className="text-muted-foreground">
              {item.jellyMailbox.memberCount} member
              {item.jellyMailbox.memberCount === 1 ? "" : "s"}
              {managed
                ? managed.writesEnabled
                  ? " · writes enabled"
                  : " · read-only"
                : " · not managed by Marmalade"}
            </Text>
          </View>
        );
      }}
    />
  );
}
