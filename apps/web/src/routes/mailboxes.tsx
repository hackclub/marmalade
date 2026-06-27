import { Button } from "@marmalade-v2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marmalade-v2/ui/components/card";
import { Checkbox } from "@marmalade-v2/ui/components/checkbox";
import { Input } from "@marmalade-v2/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { orpc } from "@/utils/orpc";

type MailboxId = number;

export const Route = createFileRoute("/todos")({
  component: MailboxesRoute,
});

function MailboxesRoute() {
  // const [newMailboxText, setNewMailboxText] = useState("");

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

  // const handleAddMailbox = (e: FormEvent<HTMLFormElement>) => {
  //   e.preventDefault();
  //   if (newMailboxText.trim()) {
  //     createMutation.mutate({ text: newMailboxText });
  //   }
  // };

  // const handleToggleMailbox = (id: MailboxId, completed: boolean) => {
  //   toggleMutation.mutate({ id, completed: !completed });
  // };

  // const handleDeleteMailbox = (id: MailboxId) => {
  //   deleteMutation.mutate({ id });
  // };

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <Card>
        <CardHeader>
          <CardTitle>Mailbox List</CardTitle>
          <CardDescription>Manage your tasks efficiently</CardDescription>
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

          {(mailboxes.isLoading ? (
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
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  <div className="flex items-center space-x-2">
                    {/* <Checkbox
                      checked={mailbox.completed}
                      onCheckedChange={() => handleToggleMailbox(mailbox.id, mailbox.completed)}
                      id={`mailbox-${mailbox.id}`}
                    /> */}
                    <label
                      htmlFor={`mailbox-${mailbox.jellyMailbox.id}`}
                      className={`${mailbox.marmaladeMailbox && mailbox.marmaladeMailbox.active ? "line-through" : ""}`}
                    >
                      {mailbox.jellyMailbox.name}
                    </label>
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
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
