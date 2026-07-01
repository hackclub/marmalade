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
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { MemberCard } from "./team";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/mailboxes")({
  component: MailboxesRoute,
});

function MailboxCard({
  mailbox,
  teamMember,
  createMutate,
}: {
  mailbox: any;
  teamMember: any;
  createMutate: (variables: { jellyMailboxId: string }) => void;
}) {
  const handleCreateMailbox = () => {
    createMutate({
      jellyMailboxId: mailbox.jellyMailbox.jellyMailboxId,
    });
  };

  const [membersShowing, setMembersShowing] = useState(false);

  function toggleMembersShowing() {
    setMembersShowing(!membersShowing);
  }

  return (
    <li
      key={mailbox.jellyMailbox.id}
      className="flex flex-col justify-between gap-3 rounded-md border p-2"
    >
      <div className="flex items-center space-x-1">
        <label htmlFor={`mailbox-${mailbox.jellyMailbox.id}`}>
          {mailbox.jellyMailbox.name}
        </label>
        <span className="text-gray-500">
          ({mailbox.jellyMailbox.jellyMailboxId})
        </span>

        <Badge
          variant={
            mailbox.marmaladeMailbox && !mailbox.marmaladeMailbox.active
              ? "destructive"
              : mailbox.marmaladeMailbox
                ? "secondary"
                : "outline"
          }
        >
          {mailbox.marmaladeMailbox && !mailbox.marmaladeMailbox.active
            ? "Paused"
            : mailbox.marmaladeMailbox
              ? "🍊 Linked"
              : "Unlinked"}
        </Badge>
        {mailbox.marmaladeMailbox && (
          <Badge
            variant={
              mailbox.marmaladeMailbox && !mailbox.marmaladeMailbox.active
                ? "destructive"
                : mailbox.marmaladeMailbox
                  ? "secondary"
                  : "outline"
            }
          >
            {mailbox.marmaladeMailbox.memberCount} /{" "}
            {mailbox.jellyMailbox.memberCount} members perm'd
          </Badge>
        )}
      </div>

      <div className="flex flex-row items-center justify-end gap-2">
        {!mailbox.marmaladeMailbox ? (
          teamMember.role == "owner" || teamMember.role == "admin" ? (
            <Button onClick={handleCreateMailbox} variant="outline">
              🍊 Link
            </Button>
          ) : (
            <Button variant="outline">🍊 Request Linkage</Button>
          )
        ) : null}

        {mailbox.marmaladeMailbox ? (
          membersShowing ? (
            <Button onClick={toggleMembersShowing} variant="outline">
              🙈 Hide Members
            </Button>
          ) : (
            <Button variant="outline" onClick={toggleMembersShowing}>
              👀 Show Members
            </Button>
          )
        ) : null}

        {teamMember.role == "owner" || teamMember.role == "admin" ? (
          <>
            <Button disabled variant="outline">
              💤 Deactivate
            </Button>
            <Button disabled variant="outline">
              ❌ Delete
            </Button>
          </>
        ) : null}
      </div>
      {membersShowing && mailbox.marmaladeMailbox && (
        <>
          <p className="font-semibold">
            Members ({mailbox.jellyMailbox.memberCount})
          </p>
          <ul className="list-disc pl-5">
            {mailbox.jellyMailbox.members.map((member: any) => (
              <MemberCard
                member={{ jelly: member }}
                teamMemberRole={teamMember.role}
                extraBadges={
                  <Badge variant="destructive">
                    {mailbox.marmaladeMailbox.members.find(
                      (m: any) => m.email === member.email,
                    )
                      ? "🍊 perm'd"
                      : "unperm'd"}
                  </Badge>
                }
                extraActions={
                  teamMember.role == "owner" || teamMember.role == "admin" ? (
                    <Button variant="secondary">Grant perms</Button>
                  ) : null
                }
              />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

function MailboxesRoute() {
  // const [newMailboxText, setNewMailboxText] = useState("");
  const { teamMember } = Route.useRouteContext();

  const mailboxes = useQuery(orpc.mailbox.list.queryOptions());
  // const createMutation = useMutation(
  //   orpc.mailbox.create.mutationOptions({
  //     onSuccess: () => {
  //       mailboxes.refetch();
  //       setNewMailboxText("");
  //     },
  //   }),
  // );
  // const toggleMutation = useMutation(
  //   orpc.mailbox.toggle.mutationOptions({
  //     onSuccess: () => {
  //       mailboxes.refetch();
  //     },
  //   }),
  // );
  // const deleteMutation = useMutation(
  //   orpc.mailbox.delete.mutationOptions({
  //     onSuccess: () => {
  //       mailboxes.refetch();
  //     },
  //   }),
  // );

  const resyncMutation = useMutation(
    orpc.mailbox.resync.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
      },
    }),
  );
  const createMutation = useMutation(
    orpc.mailbox.create.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
      },
    }),
  );

  // const handleToggleMailbox = (id: MailboxId, completed: boolean) => {
  //   toggleMutation.mutate({ id, completed: !completed });
  // };

  // const handleDeleteMailbox = (id: MailboxId) => {
  //   deleteMutation.mutate({ id });
  // };

  const handleResyncMailboxes = () => {
    resyncMutation.mutate({});
  };

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <Card>
        <CardHeader className="items-center justify-between">
          <CardTitle>Your Mailboxes</CardTitle>
          <CardDescription>
            View and manage your mailboxes as a <u>team {teamMember.role}</u>
          </CardDescription>
          <CardAction>
            <Button onClick={handleResyncMailboxes} className="mb-4">
              Resync Mailboxes
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {/* <form onSubmit={handleAddMailbox} className="mb-6 flex items-center space-x-2">
            <Input
              value={newMailboxText}
              onChange={(e) => setNewMailboxText(e.target.value)}
              placeholder="Add a new task..."
              disabled={createMutation.isPending}
            />
            <Button type="submit" disabled={createMutation.isPending || !newMailboxText.trim()}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </form> */}

          {mailboxes.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : mailboxes.data?.length === 0 ? (
            <p className="py-4 text-center">No mailboxes yet. Add one above!</p>
          ) : (
            <ul className="space-y-2">
              {mailboxes.data?.map((mailbox) => (
                <MailboxCard
                  mailbox={mailbox}
                  teamMember={teamMember}
                  createMutate={createMutation.mutate}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
