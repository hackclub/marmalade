import { Button } from "@marmalade-v2/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

import Loader from "./loader";

export default function SignInForm() {
  const navigate = useNavigate({
    from: "/",
  });
  const { isPending, data } = authClient.useSession();

  if (isPending) {
    return <Loader />;
  }

  if (data?.session) {
    navigate({ to: "/dashboard" });
    return null;
  }

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">
        Welcome to Marmalade
      </h1>
      <p className="mb-8 text-center text-gray-600">
        Sign in with your Hack Club account to continue
      </p>

      <Button
        className="w-full"
        size="lg"
        onClick={async () => {
          const { error } = await authClient.signIn.oauth2({
            providerId: "hackclub",
            callbackURL: "/dashboard",
          });
          if (error) {
            toast.error(error.message || "Failed to sign in with Hack Club");
          }
        }}
      >
        Sign in with Hack Club
      </Button>
    </div>
  );
}
