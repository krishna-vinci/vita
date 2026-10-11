import type { MemoryProposal, Resume } from "@vita/shared";
import { useCallback, useState } from "react";
import { useResumeChat } from "@/api/queries";
import { allBullets } from "@/lib/resume-view";

export interface Change {
  id: string;
  before: string;
  after: string;
  hidden: boolean;
}
export interface Message {
  role: "user" | "assistant" | "error";
  text: string;
  changes?: Change[];
  memoryProposals?: MemoryProposal[];
}

/** Chat history lives in the page; the server keeps the last few turns for context. */
export function useChatThread(scope: "application" | "resume", id: string, resume: Resume | undefined) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [changed, setChanged] = useState<string[]>([]);
  const chat = useResumeChat(scope, id);
  const { mutateAsync } = chat;
  const send = useCallback(
    async (message: string) => {
      const before = new Map((resume ? allBullets(resume) : []).map((bullet) => [bullet.id, bullet]));
      setMessages((all) => [...all, { role: "user", text: message }]);
      try {
        const reply = await mutateAsync(message);
        const after = new Map(
          (reply.resource ? allBullets(reply.resource.resume) : []).map((bullet) => [bullet.id, bullet]),
        );
        const changes = reply.changedBullets.flatMap((bulletId): Change[] => {
          const next = after.get(bulletId);
          const prev = before.get(bulletId);
          if (!next || (prev?.text === next.text && !!prev?.hidden === !!next.hidden)) return [];
          return [{ id: bulletId, before: prev?.text ?? "", after: next.text, hidden: !!next.hidden }];
        });
        setChanged(changes.map((change) => change.id));
        setMessages((all) => [
          ...all,
          { role: "assistant", text: reply.reply, changes, memoryProposals: reply.memoryProposals },
        ]);
      } catch (error) {
        setMessages((all) => [
          ...all,
          { role: "error", text: error instanceof Error ? error.message : "That didn't work. Please try again." },
        ]);
      }
    },
    [mutateAsync, resume],
  );
  return { messages, send, pending: chat.isPending, changed, clearChanged: () => setChanged([]) };
}
