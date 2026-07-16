import { orpc } from "@/utils/orpc";
import {
  apiKeySchema,
  commentSchema,
  conversationSchema,
  messageSchema,
  NON_SCOPABLE_FIELDS,
  teamMemberSchema,
} from "@marmalade-v2/api/schemas";
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
import { Check, ChevronDown, ChevronRight, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

const SCHEMA_MAP: Record<string, { schema: any; label: string; scopeId: string }> = {
  conversation: { schema: conversationSchema, label: "Conversation", scopeId: "convo" },
  message: { schema: messageSchema, label: "Message", scopeId: "message" },
  comment: { schema: commentSchema, label: "Comment", scopeId: "comment" },
  team: { schema: teamMemberSchema, label: "Team Contact", scopeId: "team" },
  apiKey: { schema: apiKeySchema, label: "API Key", scopeId: "apiKey" },
};

function getScorableFields(resourceType: string): string[] {
  const entry = SCHEMA_MAP[resourceType];
  if (!entry) return [];
  const exclusions = NON_SCOPABLE_FIELDS[resourceType] ?? [];
  return Object.keys(entry.schema.shape).filter(
    (key) => !exclusions.includes(key),
  );
}

const RESOURCE_DEFINITIONS: Array<{
  id: string;
  scopeId: string;
  label: string;
  fields: string[];
  hasMailboxList?: boolean;
}> = [
  {
    id: "mailbox",
    scopeId: "mailbox",
    label: "Mailbox",
    fields: [],
    hasMailboxList: true,
  },
  ...Object.entries(SCHEMA_MAP).map(([id, { label, scopeId }]) => ({
    id,
    scopeId,
    label,
    fields: getScorableFields(id),
  })),
  // {
  //   id: "attachment",
  //   scopeId: "convo",
  //   label: "Attachment",
  //   fields: ["filename", "content_type", "byte_size", "url", "inline"],
  // },
];

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
  const [detailsShowing, setDetailsShowing] = useState(false);

  function toggleDetailsShowing() {
    setDetailsShowing(!detailsShowing);
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
          {(apiKey.mailboxIds.length > 0 ||
            apiKey.resourceScopes?.length > 0 ||
            apiKey.fieldScopes?.length > 0) && (
            <Button onClick={toggleDetailsShowing} variant="outline">
              {detailsShowing ? "🙈 Hide" : "👀 Show"} Scopes
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
      {detailsShowing && (
        <div className="space-y-2">
          {apiKey.resourceScopes?.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-semibold">
                Resource Scopes ({apiKey.resourceScopes.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {apiKey.resourceScopes.map((scope: string) => (
                  <Badge key={scope} variant="secondary" className="text-xs">
                    {scope}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {apiKey.mailboxIds.length > 0 && (
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
          {apiKey.fieldScopes?.length > 0 && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-semibold">
                Field Scopes ({apiKey.fieldScopes.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {apiKey.fieldScopes.map(
                  (scope: { resourceType: string; field: string }) => (
                    <Badge
                      key={`${scope.resourceType}:${scope.field}`}
                      variant="secondary"
                      className="text-xs"
                    >
                      {scope.resourceType}.{scope.field}
                    </Badge>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ResourceScopeSection({
  scopeId,
  label,
  fields,
  hasMailboxList,
  expanded,
  onToggleExpanded,
  selectedResourceScopes,
  selectedFieldScopes,
  selectedMailboxIds,
  accessibleMailboxes,
  mailboxesLoading,
  onToggleResource,
  onToggleField,
  onToggleMailbox,
}: {
  scopeId: string;
  label: string;
  fields: string[];
  hasMailboxList?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  selectedResourceScopes: string[];
  selectedFieldScopes: Array<{ resourceType: string; field: string }>;
  selectedMailboxIds: string[];
  accessibleMailboxes: Array<{
    jellyMailbox: { jellyMailboxId: string; name: string };
  }>;
  mailboxesLoading: boolean;
  onToggleResource: (scopeId: string) => void;
  onToggleField: (resourceType: string, field: string) => void;
  onToggleMailbox: (mailboxId: string) => void;
}) {
  const isRouterSelected = selectedResourceScopes.includes(scopeId);
  const hasSubItems = hasMailboxList || fields.length > 0;

  const allMailboxIds = accessibleMailboxes.map(
    (m) => m.jellyMailbox.jellyMailboxId,
  );
  const allMailboxesSelected =
    hasMailboxList &&
    allMailboxIds.length > 0 &&
    allMailboxIds.every((id) => selectedMailboxIds.includes(id));
  const someMailboxesSelected =
    hasMailboxList &&
    allMailboxIds.some((id) => selectedMailboxIds.includes(id)) &&
    !allMailboxesSelected;

  const allFieldsSelected =
    fields.length > 0 &&
    fields.every((field) =>
      selectedFieldScopes.some(
        (s) => s.resourceType === scopeId && s.field === field,
      ),
    );
  const someFieldsSelected =
    fields.length > 0 &&
    fields.some((field) =>
      selectedFieldScopes.some(
        (s) => s.resourceType === scopeId && s.field === field,
      ),
    ) &&
    !allFieldsSelected;

  const hasIndeterminate = someMailboxesSelected || someFieldsSelected;

  return (
    <div className="rounded-md border">
      <div className="hover:bg-muted flex items-center gap-2 px-3 py-2">
        {hasSubItems ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="w-4" />
        )}
        <Checkbox
          checked={isRouterSelected}
          indeterminate={hasIndeterminate && !isRouterSelected}
          onCheckedChange={() => onToggleResource(scopeId)}
        />
        <span className="text-sm font-medium">{label}</span>
      </div>

      {expanded && hasSubItems && (
        <div className="border-t px-6 py-2">
          {hasMailboxList && (
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-semibold">
                Mailboxes
              </p>
              {mailboxesLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                </div>
              ) : accessibleMailboxes.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No mailboxes available
                </p>
              ) : (
                <div className="max-h-32 overflow-y-auto">
                  {accessibleMailboxes.map((mailbox) => (
                    <label
                      key={mailbox.jellyMailbox.jellyMailboxId}
                      className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1"
                    >
                      <Checkbox
                        checked={selectedMailboxIds.includes(
                          mailbox.jellyMailbox.jellyMailboxId,
                        )}
                        onCheckedChange={() =>
                          onToggleMailbox(mailbox.jellyMailbox.jellyMailboxId)
                        }
                      />
                      <span className="text-xs">
                        {mailbox.jellyMailbox.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {fields.length > 0 && (
            <div className={hasMailboxList ? "mt-2" : ""}>
              <p className="text-muted-foreground mb-1 text-xs font-semibold">
                Fields
              </p>
              <div className="flex flex-wrap gap-2">
                {fields.map((field) => (
                  <label
                    key={field}
                    className="hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1"
                  >
                    <Checkbox
                      checked={selectedFieldScopes.some(
                        (s) => s.resourceType === scopeId && s.field === field,
                      )}
                       onCheckedChange={() => onToggleField(scopeId, field)}
                    />
                    <span className="text-xs">{field}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateKeyDialog({
  createScopedMutate,
  isPending,
}: {
  createScopedMutate: (variables: {
    mailboxId: string;
    name: string;
    description?: string;
    mailboxIds?: string[];
    resourceScopes?: string[];
    fieldScopes?: Array<{ resourceType: string; field: string }>;
    expiresAt?: string;
  }) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedMailboxIds, setSelectedMailboxIds] = useState<string[]>([]);
  const [selectedResourceScopes, setSelectedResourceScopes] = useState<string[]>(
    [],
  );
  const [selectedFieldScopes, setSelectedFieldScopes] = useState<
    Array<{ resourceType: string; field: string }>
  >([]);

  const [expandedResources, setExpandedResources] = useState<
    Record<string, boolean>
  >({});

  const mailboxes = useQuery(orpc.mailbox.list.queryOptions());
  const accessibleMailboxes =
    mailboxes.data?.filter((m) => m.marmaladeMailbox !== null) ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedMailboxIds.length === 0) return;

    createScopedMutate({
      mailboxId: selectedMailboxIds[0],
      name: name.trim(),
      description: description.trim() || undefined,
      mailboxIds: selectedMailboxIds,
      resourceScopes:
        selectedResourceScopes.length > 0
          ? selectedResourceScopes
          : undefined,
      fieldScopes:
        selectedFieldScopes.length > 0 ? selectedFieldScopes : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });

    setName("");
    setDescription("");
    setExpiresAt("");
    setSelectedMailboxIds([]);
    setSelectedResourceScopes([]);
    setSelectedFieldScopes([]);
    setExpandedResources({});
    setOpen(false);
  };

  const toggleExpandedResource = (routerId: string) => {
    setExpandedResources((prev) => ({
      ...prev,
      [routerId]: !prev[routerId],
    }));
  };

  const toggleResource = (scopeId: string) => {
    const routerDef = RESOURCE_DEFINITIONS.find((r) => r.scopeId === scopeId);
    if (!routerDef) return;

    const isCurrentlySelected = selectedResourceScopes.includes(scopeId);

    if (isCurrentlySelected) {
      setSelectedResourceScopes((prev) => prev.filter((id) => id !== scopeId));
      setExpandedResources((prev) => ({ ...prev, [routerDef.id]: false }));

      if (routerDef.hasMailboxList) {
        setSelectedMailboxIds([]);
      }
      if (routerDef.fields.length > 0) {
        setSelectedFieldScopes((prev) =>
          prev.filter((s) => s.resourceType !== scopeId),
        );
      }
    } else {
      setSelectedResourceScopes((prev) => [...prev, scopeId]);
      setExpandedResources((prev) => ({ ...prev, [routerDef.id]: true }));

      if (routerDef.hasMailboxList) {
        setSelectedMailboxIds(
          accessibleMailboxes.map((m) => m.jellyMailbox.jellyMailboxId),
        );
      }
      if (routerDef.fields.length > 0) {
        setSelectedFieldScopes((prev) => {
          const withoutThisRouter = prev.filter(
            (s) => s.resourceType !== scopeId,
          );
          const newFields = routerDef.fields.map((field) => ({
            resourceType: scopeId,
            field,
          }));
          return [...withoutThisRouter, ...newFields];
        });
      }
    }
  };

  const toggleField = (resourceType: string, field: string) => {
    setSelectedFieldScopes((prev) => {
      const exists = prev.some(
        (s) => s.resourceType === resourceType && s.field === field,
      );
      if (exists) {
        return prev.filter(
          (s) => !(s.resourceType === resourceType && s.field === field),
        );
      }
      return [...prev, { resourceType, field }];
    });
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
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for marmalade API access.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto py-4">
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
            {/* 
            description probably isn't helpful for now
            <div className="grid gap-2">
              <Label htmlFor="key-description">Description (optional)</Label>
              <Input
                id="key-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="describe it?"
                disabled={isPending}
              />
            </div> */}
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
              <Label>Resource Scopes (optional)</Label>
              <p className="text-muted-foreground text-xs">
                Select the minimum resources, mailboxes, and fields your key needs access.
              </p>
              <div className="flex flex-col gap-1">
                    {RESOURCE_DEFINITIONS.map((router) => (
                      <ResourceScopeSection
                        key={router.id}
                        scopeId={router.scopeId}
                        label={router.label}
                        fields={router.fields}
                        hasMailboxList={router.hasMailboxList}
                        expanded={expandedResources[router.id] ?? false}
                        onToggleExpanded={() => toggleExpandedResource(router.id)}
                    selectedResourceScopes={selectedResourceScopes}
                    selectedFieldScopes={selectedFieldScopes}
                    selectedMailboxIds={selectedMailboxIds}
                    accessibleMailboxes={accessibleMailboxes}
                    mailboxesLoading={mailboxes.isLoading}
                    onToggleResource={toggleResource}
                    onToggleField={toggleField}
                    onToggleMailbox={toggleMailbox}
                  />
                ))}
              </div>
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
            <Button type="submit" disabled={isPending || !name.trim() || selectedMailboxIds.length === 0}>
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
              createScopedMutate={createScopedMutation.mutate}
              isPending={createScopedMutation.isPending}
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
