import { Check, History, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SavedChat } from "@/lib/use-chat-thread";
import { cn } from "@/lib/utils";

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
/** "3 hours ago", "yesterday", "just now". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff) || Math.abs(diff) < 60_000) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  return "just now";
}

/** One quiet row on top of every chat: the thread's title, its history, and a way to start over. */
export function ChatHeader({ chat, className }: { chat: SavedChat; className?: string }) {
  const [confirm, setConfirm] = useState<{ id: string; title: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const title = chat.title.trim() || "New chat";
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <h2 className="min-w-0 flex-1 truncate font-display text-lg font-medium" title={title}>
        {title}
      </h2>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 px-2 text-muted-foreground" aria-label="History">
            <History aria-hidden="true" />
            <span className="max-sm:sr-only">History</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-80">
          {chat.history.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No earlier chats yet.</p>
          ) : (
            chat.history.map((entry) => {
              const name = entry.title.trim() || "New chat";
              return (
                <div key={entry.id} className="flex items-center gap-1">
                  <DropdownMenuItem
                    className="min-h-11 flex-1 flex-col items-start gap-0"
                    aria-current={entry.id === chat.threadId ? "true" : undefined}
                    onSelect={() => chat.select(entry.id)}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                      {entry.id === chat.threadId && <Check className="size-4 text-primary" aria-label="Open now" />}
                    </span>
                    <span className="text-xs text-muted-foreground">{relativeTime(entry.updatedAt)}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="size-11 justify-center text-muted-foreground"
                    aria-label={`Delete chat ${name}`}
                    onSelect={() => setConfirm({ id: entry.id, title: name })}
                  >
                    <Trash2 aria-hidden="true" />
                  </DropdownMenuItem>
                </div>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5 px-2 text-muted-foreground"
        aria-label="New chat"
        onClick={chat.newChat}
      >
        <Plus aria-hidden="true" />
        <span className="max-sm:sr-only">New chat</span>
      </Button>
      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirm?.title}" is removed for good. Changes it already made stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" className="h-11">
                Keep it
              </Button>
            </AlertDialogCancel>
            <Button
              variant="destructive"
              className="h-11"
              disabled={removing}
              onClick={async () => {
                if (!confirm) return;
                setRemoving(true);
                try {
                  await chat.remove(confirm.id);
                  setConfirm(null);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not delete that chat.");
                } finally {
                  setRemoving(false);
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Grey bubbles while a saved thread loads. */
export function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading the chat">
      <div className="h-10 w-3/4 animate-pulse rounded-xl bg-muted" />
      <div className="h-14 w-2/3 animate-pulse self-end rounded-xl bg-muted" />
      <div className="h-10 w-1/2 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
