import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { SignIn } from "@/components/sign-in";
import { authClient } from "@/lib/auth-client";

/**
 * Entry gate. Signed-out users get the sign-in screen; everyone else goes
 * straight to the tabs.
 */
export default function Index() {
  const { data, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!data?.session) return <SignIn />;

  return <Redirect href="/(tabs)" />;
}
