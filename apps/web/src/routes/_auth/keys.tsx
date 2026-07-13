import { orpc } from "@/utils/orpc";
import { Badge } from "@marmalade-v2/ui/components/badge";
import { Button } from "@marmalade-v2/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marmalade-v2/ui/components/card";
import { Checkbox } from "@marmalade-v2/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@marmalade-v2/ui/components/dialog";
import { Input } from "@marmalade-v2/ui/components/input";
import { Label } from "@marmalade-v2/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_auth/keys")({
  component: KeysRoute,
});

function KeyCard({
  apiKey,
  teamMemberRole,
  revokeMutate,
}: {
  apiKey: any;
  teamMemberRole: string;
  revokeMutate: (variables: { keyId: number }) => void;
}) {
  const isAdmin = teamMemberRole === "owner" || teamMemberRole === "admin";
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date();
  const [mailboxesShowing, setMailboxesShowing] = useState(false);

  function toggleMailboxesShowing() {
    setMailboxesShowing(!mailboxesShowing);
  }

  return (
    <li className="flex flex-col justify-between gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {apiKey.name} ({apiKey.keyPrefix}...)
          </span>
          {apiKey.description && (
            <span className="text-muted-foreground text-sm">
              {apiKey.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">by {apiKey.createdByName}</Badge>
          {isExpired ? (
            <Badge variant="outline">Expired</Badge>
          ) : apiKey.active ? (
            <Badge>
              Expires {new Date(apiKey.expiresAt).toLocaleDateString()}
            </Badge>
          ) : (
            <Badge variant="destructive">Revoked</Badge>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          {apiKey.lastUsedAt && (
            <span>
              Last used: {new Date(apiKey.lastUsedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="flex flex-row items-center justify-end gap-2">
          {apiKey.mailboxIds.length === 0 ? null : mailboxesShowing ? (
            <Button onClick={toggleMailboxesShowing} variant="outline">
              🙈 Hide Mailboxes
            </Button>
          ) : (
            <Button variant="outline" onClick={toggleMailboxesShowing}>
              👀 Show Mailboxes
            </Button>
          )}
          {isAdmin && !apiKey.revokedAt && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => revokeMutate({ keyId: apiKey.id })}
            >
              ❌ Revoke
            </Button>
          )}
        </div>
      </div>
      {mailboxesShowing && apiKey.mailboxIds.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-semibold">
            Scoped Mailboxes ({apiKey.mailboxIds.length}):
          </p>

          <ul className="text-muted-foreground list-disc pl-4 text-xs">
            {apiKey.mailboxIds.map((id: string) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function CreateKeyDialog({
  createTeamMutate,
  createScopedMutate,
  isPending,
}: {
  createTeamMutate: (variables: {
    name: string;
    description?: string;
    expiresAt?: string;
  }) => void;
  createScopedMutate: (variables: {
    mailboxId: string;
    name: string;
    description?: string;
    mailboxIds?: string[];
    expiresAt?: string;
  }) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedMailboxIds, setSelectedMailboxIds] = useState<string[]>([]);

  const mailboxes = useQuery(orpc.mailbox.list.queryOptions());
  const accessibleMailboxes =
    mailboxes.data?.filter((m) => m.marmaladeMailbox !== null) ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (selectedMailboxIds.length > 0) {
      createScopedMutate({
        mailboxId: selectedMailboxIds[0],
        name: name.trim(),
        description: description.trim() || undefined,
        mailboxIds: selectedMailboxIds,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
    } else {
      createTeamMutate({
        name: name.trim(),
        description: description.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
    }

    setName("");
    setDescription("");
    setExpiresAt("");
    setSelectedMailboxIds([]);
    setOpen(false);
  };

  const toggleMailbox = (jellyMailboxId: string) => {
    setSelectedMailboxIds((prev) =>
      prev.includes(jellyMailboxId)
        ? prev.filter((id) => id !== jellyMailboxId)
        : [...prev, jellyMailboxId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button className="mb-4">Create API Key</Button>}
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for marmalade API access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="whatever you're making"
                disabled={isPending}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key-description">Description (optional)</Label>
              <Input
                id="key-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="describe it"
                disabled={isPending}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key-expires">Expires (optional)</Label>
              <Input
                id="key-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={isPending}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>
            <div className="grid gap-2">
              <Label>Scoped Mailboxes (optional)</Label>
              {mailboxes.isLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading
                  mailboxes...
                </div>
              ) : accessibleMailboxes.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  You need to join a mailbox
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                  {accessibleMailboxes.map((mailbox) => (
                    <label
                      key={mailbox.jellyMailbox.jellyMailboxId}
                      className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5"
                    >
                      <Checkbox
                        checked={selectedMailboxIds.includes(
                          mailbox.jellyMailbox.jellyMailboxId,
                        )}
                        onCheckedChange={() =>
                          toggleMailbox(mailbox.jellyMailbox.jellyMailboxId)
                        }
                      />
                      <span className="text-sm">
                        {mailbox.jellyMailbox.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {selectedMailboxIds.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  {selectedMailboxIds.length} mailbox
                  {selectedMailboxIds.length !== 1 ? "es" : ""} selected.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KeyCreatedDialog({
  secret,
  open,
  onClose,
}: {
  secret: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (secret) {
      navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>API Key Created</DialogTitle>
          <DialogDescription>
            Copy your API key now. You won't be able to see it again.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted flex items-center gap-2 rounded-md border p-3">
          <code className="flex-1 font-mono text-sm break-all">{secret}</code>
          <Button variant="ghost" size="icon-sm" onClick={handleCopy}>
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeysRoute() {
  const { teamMember } = Route.useRouteContext();
  const keys = useQuery(orpc.apiKey.listTeam.queryOptions());
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [showCreatedDialog, setShowCreatedDialog] = useState(false);

  const createMutation = useMutation(
    orpc.apiKey.createTeam.mutationOptions({
      onSuccess: (data) => {
        setCreatedSecret(data.secret);
        setShowCreatedDialog(true);
        keys.refetch();
      },
    }),
  );

  const createScopedMutation = useMutation(
    orpc.apiKey.create.mutationOptions({
      onSuccess: (data) => {
        setCreatedSecret(data.secret);
        setShowCreatedDialog(true);
        keys.refetch();
      },
    }),
  );

  const revokeMutation = useMutation(
    orpc.apiKey.revokeTeamKey.mutationOptions({
      onSuccess: () => {
        keys.refetch();
      },
    }),
  );

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <Card>
        <CardHeader className="items-center justify-between">
          <CardTitle>Your API Keys</CardTitle>
          <CardDescription>
            View and manage your keys as a <u>team {teamMember.role}</u>
          </CardDescription>
          <CardAction>
            <CreateKeyDialog
              createTeamMutate={createMutation.mutate}
              createScopedMutate={createScopedMutation.mutate}
              isPending={
                createMutation.isPending || createScopedMutation.isPending
              }
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {keys.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : keys.data?.length === 0 ? (
            <p className="py-4 text-center">
              No API keys yet. Create one above to get started.
            </p>
          ) : (
            <ul className="space-y-2">
              {keys.data?.map((key) => (
                <KeyCard
                  key={key.id}
                  apiKey={key}
                  teamMemberRole={teamMember.role}
                  revokeMutate={revokeMutation.mutate}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <KeyCreatedDialog
        secret={createdSecret}
        open={showCreatedDialog}
        onClose={() => {
          setShowCreatedDialog(false);
          setCreatedSecret(null);
        }}
      />
    </div>
  );
}
