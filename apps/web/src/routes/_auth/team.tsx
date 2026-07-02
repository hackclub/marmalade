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

import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/team")({
  component: MembersRoute,
});

export function MemberCard({
  member,
  teamMemberRole,
  extraBadges,
  extraActions,
  hideDefaultActions,
  hideDefaultBadges,
}: {
  member: any;
  teamMemberRole: string;
  extraBadges?: React.ReactNode;
  extraActions?: React.ReactNode;
  hideDefaultActions?: boolean;
  hideDefaultBadges?: boolean;
}) {
  return (
    <li className="flex flex-col justify-between gap-3 rounded-md border p-2">
      <div className="flex items-center space-x-1">
        <label
          htmlFor={`member-${member.jelly.id}`}
          className={`${!member.jelly.existsInJelly ? "line-through" : ""}`}
        >
          {member.jelly.name}
        </label>
        <span className="text-gray-500">({member.jelly.email})</span>
        {!hideDefaultBadges && (
          <>
            <Badge
              variant={
                !member.jelly.existsInJelly
                  ? "destructive"
                  : member.marmalade
                    ? "default"
                    : "secondary"
              }
            >
              {member.marmalade ? "🍊 registered" : "🍓 unlinked"}
            </Badge>
            <Badge variant="outline">{member.jelly.role}</Badge>
          </>
        )}
        {extraBadges}
      </div>
      <div className="flex flex-row items-center justify-end gap-2">
        {hideDefaultActions ? null : !member.marmalade ? (
          <Button disabled variant="outline">
            🍊 Invite
          </Button>
        ) : teamMemberRole == "owner" || teamMemberRole == "admin" ? (
          <>
            <Button disabled variant="outline">
              💤 Deactivate
            </Button>
            <Button disabled variant="outline">
              ❌ Ban
            </Button>
          </>
        ) : null}

        {extraActions}
      </div>
    </li>
  );
}

function MembersRoute() {
  const { teamMember } = Route.useRouteContext();

  const members = useQuery(orpc.team.list.queryOptions());

  const resyncMutation = useMutation(
    orpc.team.resync.mutationOptions({
      onSuccess: () => {
        members.refetch();
      },
    }),
  );

  const handleResyncMembers = () => {
    resyncMutation.mutate({});
  };

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>Your Team</CardTitle>
          <CardDescription>
            View and manage your team as a <u>team {teamMember.role}</u>
          </CardDescription>
          <CardAction>
            <Button onClick={handleResyncMembers} className="mb-4">
              Resync Members
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {members.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : members.data?.length === 0 ? (
            <p className="py-4 text-center">
              No members synced. Hit resync to populate your Jelly team.
            </p>
          ) : (
            <ul className="space-y-2">
              {members.data?.map((member) => (
                <MemberCard
                  key={member.jelly.id}
                  member={member}
                  teamMemberRole={teamMember.role}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
