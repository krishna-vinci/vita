import { useEffect, useState } from "react";
import { useResumeChat } from "@/api/queries";
import { type SavedChat, useSavedChat } from "@/lib/use-chat-thread";

export type { Message } from "@/lib/use-chat-thread";

/** The resume or job chat: a saved thread, plus the bullets the last reply changed (for highlighting). */
export function useChatThread(
  scope: "application" | "resume",
  id: string,
): SavedChat & {
  changed: string[];
  clearChanged: () => void;
} {
  const reply = useResumeChat(scope, id);
  const [changed, setChanged] = useState<string[]>([]);
  const chat = useSavedChat(scope, id, (message, threadId) => reply.mutateAsync({ message, threadId }), {
    onReply: (result) => setChanged(result.changedBullets),
  });
  // Another conversation starts without the last one's highlights.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the open thread changes.
  useEffect(() => setChanged([]), [chat.threadId]);
  return { ...chat, changed, clearChanged: () => setChanged([]) };
}
