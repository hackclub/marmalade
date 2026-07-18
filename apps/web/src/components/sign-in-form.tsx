import { Button } from "@marmalade-v2/ui/components/button";
import { Input } from "@marmalade-v2/ui/components/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@marmalade-v2/ui/components/input-otp";
import { useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import Loader from "./loader";

export default function SignInForm() {
  const navigate = useNavigate({
    from: "/",
  });
  const { isPending, data } = authClient.useSession();
  const [fixedEmail, setFixedEmail] = useState<string | null>(null);
  const [nonFixedEmail, setNonFixedEmail] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  if (isPending) {
    return <Loader />;
  }

  if (data?.session) {
    navigate({ to: "/" });
    return null;
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">
        Welcome to Marmalade
      </h1>
      <p className="mb-8 text-center text-gray-400">
        Sign in with your Hack Club account to continue
      </p>

      <Button
        className="w-full"
        size="lg"
        onClick={async () => {
          const { error } = await authClient.signIn.oauth2({
            providerId: "hackclub",
            callbackURL: "/",
          });
          if (error) {
            toast.error(error.message || "Failed to sign in with Hack Club");
          }
        }}
      >
        Sign in with Hack Club
      </Button>
      <details className="mt-4">
        <summary className="my-4 text-white">
          but... my jelly account email is different from my HCA
        </summary>
        <div className="flex flex-col gap-4">
          <p className="text-gray-400">
            (i guess i can let you in with email/password if you really want to,
            but this is a hack club app so i don't know why you would want to do
            that)
          </p>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setFixedEmail(nonFixedEmail);

              const { data, error } =
                await authClient.emailOtp.sendVerificationOtp({
                  email: nonFixedEmail, // required
                  type: "sign-in", // required
                });
              if (error) {
                setFixedEmail(null);
                toast.error(
                  error.message || "Failed to sign in with Email OTP",
                );
                return;
              }
            }}
          >
            <Input
              disabled={!!fixedEmail}
              value={nonFixedEmail}
              onChange={(e) => setNonFixedEmail(e.target.value)}
              type="email"
              name="email"
              placeholder="non-hca email"
            />

            <Button type="submit" className="w-full" size="lg">
              OTP me
            </Button>
          </form>
          {fixedEmail && (
            <form
              className="mt-2 flex flex-col items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();

                const { error } = await authClient.signIn.emailOtp({
                  email: fixedEmail, // required
                  name: fixedEmail.split("@")[0] || "",
                  otp: otp, // required
                });
                if (error) {
                  toast.error(error.message || "Failed to verify email OTP");
                } else {
                  navigate({ to: "/" });
                }
              }}
            >
              <InputOTP
                name="otp"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e)}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
              <Button type="submit" className="w-full" size="lg">
                verify OTP
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                size="lg"
                onClick={() => setFixedEmail(null)}
              >
                i typed my email wrong
              </Button>
            </form>
          )}
        </div>
      </details>
    </div>
  );
}
