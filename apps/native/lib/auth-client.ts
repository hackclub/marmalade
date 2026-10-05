import { expoClient } from "@better-auth/expo/client";
import { env } from "@marmalade-v2/env/native";
import { emailOTPClient, genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const scheme = Constants.expoConfig?.scheme;

export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_SERVER_URL,
  // Same plugin set as the web client, so both sign-in routes behave
  // identically on either platform.
  plugins: [
    genericOAuthClient(),
    emailOTPClient(),
    expoClient({
      // `marmalade-v2` is already in `trustedOrigins` on the server, so the
      // deep-link callback from the Hack Club OAuth flow is accepted.
      scheme: typeof scheme === "string" ? scheme : "marmalade-v2",
      storagePrefix: "marmalade",
      // The session token is a credential, so it belongs in the keychain
      // rather than AsyncStorage.
      storage: SecureStore,
    }),
  ],
});
