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
import { toast } from "sonner";
import { MemberCard } from "./team";

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/mailboxes")({
  component: MailboxesRoute,
});

function MailboxCard({
  mailbox,
  teamMember,
  createMailboxMutate,
  deactivateMailboxMutate,
  activateMailboxMutate,
  createMailboxMemberMutate,
  removeMailboxMemberMutate,
}: {
  mailbox: any;
  teamMember: any;
  createMailboxMutate: (variables: { jellyMailboxId: string }) => void;
  deactivateMailboxMutate: (variables: { marmaladeMailboxId: number }) => void;
  activateMailboxMutate: (variables: { marmaladeMailboxId: number }) => void;
  createMailboxMemberMutate: (variables: {
    marmaladeMailboxId: number;
    marmaladeMemberId: string;
  }) => void;
  removeMailboxMemberMutate: (variables: {
    marmaladeMailboxId: number;
    marmaladeMemberId: string;
  }) => void;
}) {
  const handleCreateMailbox = () => {
    createMailboxMutate({
      jellyMailboxId: mailbox.jellyMailbox.jellyMailboxId,
    });
  };
  const handleDeactivateMailbox = () => {
    if (mailbox.marmaladeMailbox) {
      deactivateMailboxMutate({
        marmaladeMailboxId: mailbox.marmaladeMailbox.id,
      });
    }
  };
  const handleActivateMailbox = () => {
    if (mailbox.marmaladeMailbox) {
      activateMailboxMutate({
        marmaladeMailboxId: mailbox.marmaladeMailbox.id,
      });
    }
  };
  const handleCreateMailboxMember = (marmaladeMemberId: string) => {
    createMailboxMemberMutate({
      marmaladeMailboxId: mailbox.marmaladeMailbox.id,
      marmaladeMemberId: marmaladeMemberId,
    });
  };
  const handleRemoveMailboxMember = (marmaladeMemberId: string) => {
    removeMailboxMemberMutate({
      marmaladeMailboxId: mailbox.marmaladeMailbox.id,
      marmaladeMemberId: marmaladeMemberId,
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
                ? "default"
                : "outline"
          }
        >
          {mailbox.marmaladeMailbox && !mailbox.marmaladeMailbox.active
            ? "🍊 disabled"
            : mailbox.marmaladeMailbox
              ? "🍊 mirroring"
              : "🍓 not setup"}
        </Badge>
        {mailbox.marmaladeMailbox && (
          <Badge variant="secondary">
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
            <Button disabled variant="outline">
              🍊 Request
            </Button>
          )
        ) : membersShowing ? (
          <Button onClick={toggleMembersShowing} variant="outline">
            🙈 Hide Members
          </Button>
        ) : (
          <Button variant="outline" onClick={toggleMembersShowing}>
            👀 Show Members
          </Button>
        )}

        {teamMember.role == "owner" || teamMember.role == "admin" ? (
          <>
            {mailbox.marmaladeMailbox && mailbox.marmaladeMailbox.active ? (
              <Button onClick={handleDeactivateMailbox} variant="outline">
                💤 Deactivate
              </Button>
            ) : (
              <Button onClick={handleActivateMailbox} variant="outline">
                ⏰ Reactivate
              </Button>
            )}
            <Button disabled variant="outline">
              ❌ Delete
            </Button>
          </>
        ) : null}
      </div>
      {membersShowing && mailbox.marmaladeMailbox && (
        <>
          <p className="font-semibold">
            Jelly Mailbox Members ({mailbox.jellyMailbox.memberCount})
          </p>
          <ul className="list-disc pl-5">
            {mailbox.jellyMailbox.members.map((member: any) => (
              <MemberCard
                member={{
                  jelly: { ...member.jelly, role: "team " + member.jelly.role },
                  marmalade: member.marmalade,
                }}
                teamMemberRole={teamMember.role}
                extraBadges={
                  member.marmalade ? (
                    <Badge
                      variant={
                        mailbox.marmaladeMailbox.members.find(
                          (m: any) => m.jelly.id == member.jelly.id,
                        )
                          ? "default"
                          : "destructive"
                      }
                    >
                      {mailbox.marmaladeMailbox.members.find(
                        (m: any) => m.jelly.id == member.jelly.id,
                      )
                        ? "🍊 api perms"
                        : "🍊 no perms"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">🍓 unlinked</Badge>
                  )
                }
                extraActions={
                  member.marmalade ? (
                    teamMember.role == "owner" || teamMember.role == "admin" ? (
                      mailbox.marmaladeMailbox.members.find(
                        (m: any) => m.jelly.id == member.jelly.id,
                      ) ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            handleRemoveMailboxMember(member.marmalade.id);
                          }}
                        >
                          ❌ Rescind access
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            handleCreateMailboxMember(member.marmalade.id);
                          }}
                        >
                          🛂 Grant api perms
                        </Button>
                      )
                    ) : null
                  ) : null
                }
                hideDefaultActions={true}
                hideDefaultBadges={true}
              />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

function MailboxesRoute() {
  const { teamMember } = Route.useRouteContext();

  const mailboxes = useQuery(orpc.mailbox.list.queryOptions());

  const resyncMutation = useMutation(
    orpc.mailbox.resync.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
        toast.success("Mailboxes resynced successfully");
      },
    }),
  );
  const createMailboxMutation = useMutation(
    orpc.mailbox.create.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
        toast.success("Mailbox created successfully");
      },
    }),
  );
  const deactivateMailboxMutation = useMutation(
    orpc.mailbox.deactivate.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
        toast.info("Mailbox deactivated successfully");
      },
    }),
  );
  const activateMailboxMutation = useMutation(
    orpc.mailbox.activate.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
        toast.info("Mailbox reactivated successfully");
      },
    }),
  );
  const createMailboxMemberMutation = useMutation(
    orpc.mailbox.createMember.mutationOptions({
      onSuccess: () => {
        mailboxes.refetch();
        toast.success("Mailbox member added successfully");
      },
    }),
  );
  const removeMailboxMemberMutation = useMutation(
    orpc.mailbox.removeMember.mutationOptions({
      onSuccess: () => {
        toast.info("Mailbox member removed successfully");
        mailboxes.refetch();
      },
    }),
  );

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
                  createMailboxMutate={createMailboxMutation.mutate}
                  activateMailboxMutate={activateMailboxMutation.mutate}
                  createMailboxMemberMutate={createMailboxMemberMutation.mutate}
                  removeMailboxMemberMutate={removeMailboxMemberMutation.mutate}
                  deactivateMailboxMutate={deactivateMailboxMutation.mutate}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
