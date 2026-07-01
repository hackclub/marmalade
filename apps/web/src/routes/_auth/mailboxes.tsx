import { Badge } from "@marmalade-v2/ui/components/badge";
import { Button } from "@marmalade-v2/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@marmalade-v2/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { orpc } from "@/utils/orpc";

type JellyMailboxId = string;

export const Route = createFileRoute("/_auth/mailboxes")({
  component: MailboxesRoute,
});

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

  const handleCreateMailbox = (id: JellyMailboxId) => {
    createMutation.mutate({ jellyMailboxId: id });
  };

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
        <CardHeader>
          <CardTitle>Your Mailboxes</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={handleResyncMailboxes} className="mb-4">
            Resync Mailboxes
          </Button>
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
                <li
                  key={mailbox.jellyMailbox.id}
                  className="flex flex-col justify-between rounded-md border p-2"
                >
                  <div className="flex items-center space-x-1">
                    {/* <Checkbox
                      checked={mailbox.completed}
                      onCheckedChange={() => handleToggleMailbox(mailbox.id, mailbox.completed)}
                      id={`mailbox-${mailbox.id}`}
                    /> */}
                    <label
                      htmlFor={`mailbox-${mailbox.jellyMailbox.id}`}
                      // className={`${mailbox.marmaladeMailbox && mailbox.marmaladeMailbox.active ? "line-through" : ""}`}
                    >
                      {mailbox.jellyMailbox.name}
                    </label>
                    <span className="text-gray-500">
                      ({mailbox.jellyMailbox.jellyMailboxId})
                    </span>

                    <Badge
                      variant={
                        mailbox.marmaladeMailbox &&
                        !mailbox.marmaladeMailbox.active
                          ? "destructive"
                          : mailbox.marmaladeMailbox
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {mailbox.marmaladeMailbox &&
                      !mailbox.marmaladeMailbox.active
                        ? "Paused"
                        : mailbox.marmaladeMailbox
                          ? "🍊 Linked"
                          : "Unlinked"}
                    </Badge>
                    {/* {mailbox.marmaladeMailbox && (
                        <Badge variant={(mailbox.marmaladeMailbox  && !mailbox.marmaladeMailbox.active) ? "destructive" : (mailbox.marmaladeMailbox) ? "secondary" : "outline"}>
                        {mailbox.marmaladeMailbox.memberCount} / {mailbox.jellyMailbox.memberCount} members
                       </Badge>
                      )} */}
                  </div>

                  <div className="flex flex-row justify-end items-center gap-2">
                    {!mailbox.marmaladeMailbox ? (
                      teamMember.role == "owner" ||
                      teamMember.role == "admin" ? (
                        <Button
                          onClick={() => {
                            handleCreateMailbox(
                              mailbox.jellyMailbox.jellyMailboxId,
                            );
                          }}
                          variant="outline"
                        >
                          🍊 Link
                        </Button>
                      ) : (
                        <Button variant="outline">🍊 Request Linkage</Button>
                      )
                    ) : null}

                    {teamMember.role == "owner" ||
                    teamMember.role == "admin" ? (
                      <>
                        <Button variant="outline">💤 Deactivate</Button>
                        <Button variant="outline">❌ Delete</Button>
                      </>
                    ) : null}
                  </div>
                  {/* <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteMailbox(mailbox.id)}
                    aria-label="Delete mailbox"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button> */}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
