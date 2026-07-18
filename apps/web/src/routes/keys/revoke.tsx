import { orpc } from "@/utils/orpc";
import { Button } from "@marmalade-v2/ui/components/button";
import { Input } from "@marmalade-v2/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/keys/revoke")({
  component: RevokeComponent,
});

function RevokeComponent() {
  const [revokingKey, setRevokingKey] = useState("");
  const [revoker, setRevoker] = useState("");
  const revokeKeyMutation = useMutation(
    orpc.apiKey.revokePublic.mutationOptions({
      onSuccess: () => {
        alert(`Key revoked successfully!`);
        navigate({ to: "/" });
      },
    }),
  );
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingKey.trim()) return;
    revokeKeyMutation.mutate({
      key: revokingKey,
      revoker: revoker || undefined,
    });
  };
  return (
    <div className="container mx-auto max-w-6xl px-4 py-2">
      <form onSubmit={handleSubmit}>
        thank you for your service keeping marmalade safe. we app
        <Input
          value={revokingKey}
          onChange={(e) => setRevokingKey(e.target.value)}
          placeholder="mrmld_XXXXXX..."
        />
        <Input
          value={revoker}
          onChange={(e) => setRevoker(e.target.value)}
          placeholder="who are you kind stranger? (optional)"
        />
        <Button type="submit" disabled={!revokingKey.trim()}>
          here ya go!
        </Button>
      </form>
    </div>
  );
}
