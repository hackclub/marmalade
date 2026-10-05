import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export default function SettingsScreen() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const membership = useQuery(orpc.membershipInfo.queryOptions());
  const health = useQuery(orpc.healthCheck.queryOptions());

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 gap-4"
    >
      <View className="border-border gap-1 rounded-lg border p-3">
        <Text className="text-foreground font-semibold">Signed in</Text>
        <Text className="text-muted-foreground">
          {session?.user.name} ({session?.user.email})
        </Text>
        {membership.data && (
          <Text className="text-muted-foreground">
            Jelly role: {membership.data.role}
          </Text>
        )}
      </View>

      <View className="border-border gap-1 rounded-lg border p-3">
        <Text className="text-foreground font-semibold">Server</Text>
        <Text className="text-muted-foreground">
          {health.data === "OK" ? "reachable" : "unreachable"}
        </Text>
      </View>

      <View className="border-border flex-row items-center justify-between rounded-lg border p-3">
        <Text className="text-foreground font-semibold">Theme</Text>
        <ThemeToggle />
      </View>

      <Pressable
        onPress={async () => {
          await authClient.signOut();
          router.replace("/");
        }}
        className="border-border items-center rounded-lg border p-4"
      >
        <Text className="text-red-600">Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
