import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { authClient } from "@/lib/auth-client";

/**
 * Same two routes as the web app: Hack Club OIDC for everyone, email OTP for
 * people whose Jelly address is not their Hack Club one.
 */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signInWithHackClub = async () => {
    setBusy(true);
    const { error } = await authClient.signIn.oauth2({
      providerId: "hackclub",
      callbackURL: "/",
    });
    setBusy(false);
    if (error) Alert.alert("Sign in failed", error.message ?? "Unknown error");
  };

  const sendOtp = async () => {
    setBusy(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    setBusy(false);
    if (error) {
      Alert.alert("Could not send code", error.message ?? "Unknown error");
      return;
    }
    setOtpSentTo(email);
  };

  const verifyOtp = async () => {
    if (!otpSentTo) return;
    setBusy(true);
    const { error } = await authClient.signIn.emailOtp({
      email: otpSentTo,
      otp,
    });
    setBusy(false);
    if (error) Alert.alert("Invalid code", error.message ?? "Unknown error");
  };

  return (
    <View className="bg-background flex-1 justify-center gap-6 p-6">
      <View className="gap-2">
        <Text className="text-foreground text-center text-3xl font-bold">
          🍊 Marmalade
        </Text>
        <Text className="text-muted-foreground text-center">
          Permissioned access to Jelly
        </Text>
      </View>

      <Pressable
        disabled={busy}
        onPress={signInWithHackClub}
        className="bg-foreground items-center rounded-lg p-4"
      >
        {busy ? (
          <ActivityIndicator />
        ) : (
          <Text className="text-background font-semibold">
            Sign in with Hack Club
          </Text>
        )}
      </Pressable>

      <View className="gap-3">
        <Text className="text-muted-foreground text-center">
          or, if your Jelly email is different
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          editable={!otpSentTo}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          className="border-border text-foreground rounded-lg border p-4"
        />

        {otpSentTo ? (
          <>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="6-digit code"
              keyboardType="number-pad"
              className="border-border text-foreground rounded-lg border p-4 text-center"
            />
            <Pressable
              disabled={busy}
              onPress={verifyOtp}
              className="border-border items-center rounded-lg border p-4"
            >
              <Text className="text-foreground">Verify code</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            disabled={busy || email.length === 0}
            onPress={sendOtp}
            className="border-border items-center rounded-lg border p-4"
          >
            <Text className="text-foreground">Email me a code</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
