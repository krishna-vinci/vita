import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatKind, ChatMessage, ChatThreadSummary } from "@vita/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys } from "@/api/keys";

/** A message as shown: saved ones from the thread, plus the one being sent. */
export type Message = Pick<ChatMessage, "role" | "text" | "changes" | "proposal" | "memoryProposals" | "applied"> & {
  id: string;
};
export type { ChatMessage };

export interface SavedChat {
  kind: ChatKind;
  key: string;
  /** The open thread, or null for a new chat that has no thread until its first message. */
  threadId: string | null;
  title: string;
  messages: Message[];
  loading: boolean;
  pending: boolean;
  history: ChatThreadSummary[];
  /** Names this conversation's unsent text in storage. */
  draftKey: string;
  send: (message: string) => Promise<void>;
  /** Sends the last thing the person said again. */
  retry: () => void;
  newChat: () => void;
  select: (threadId: string) => void;
  remove: (threadId: string) => Promise<void>;
}

interface Options<Reply> {
  /** Called with each reply, before the thread is reloaded. Return extra fields to show on that reply. */
  decorate?: (reply: Reply) => Partial<Message> | undefined;
  onReply?: (reply: Reply) => void;
}

/**
 * One saved conversation at a time for a chat kind and key. The open thread is kept in the URL (`?thread=`),
 * so a reload or a shared link comes back to it; without it the newest thread opens. "New chat" makes no
 * thread until the first message is sent.
 */
export function useSavedChat<Reply extends { threadId?: string; messageId?: string }>(
  kind: ChatKind,
  key: string,
  sendMessage: (message: string, threadId?: string) => Promise<Reply>,
  options: Options<Reply> = {},
): SavedChat {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const param = params.get("thread");
  const [fresh, setFresh] = useState(false);
  const [sending, setSending] = useState<{ threadId: string | null; text: string } | null>(null);
  const [failure, setFailure] = useState<{ threadId: string | null; text: string } | null>(null);
  const [extras, setExtras] = useState<Record<string, Partial<Message>>>({});
  const latest = useRef({ sendMessage, options });
  latest.current = { sendMessage, options };

  const listKey = queryKeys.chatThreads(kind, key);
  const list = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => api.chats.list(kind, key, signal),
    enabled: !!key,
  });
  const history = list.data ?? [];
  const threadId = param ?? (fresh ? null : (history[0]?.id ?? null));
  const thread = useQuery({
    queryKey: queryKeys.chatThread(kind, key, threadId ?? ""),
    queryFn: ({ signal }) => api.chats.get(kind, key, threadId ?? "", signal),
    enabled: !!threadId,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });

  const open = useCallback(
    (id: string | null) =>
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          if (id) copy.set("thread", id);
          else copy.delete("thread");
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );
  // Make the newest thread the one in the URL, so a reload stays on it.
  useEffect(() => {
    if (!param && !fresh && history[0]) open(history[0].id);
  }, [param, fresh, history, open]);
  // A link to a thread that no longer exists falls back to a new chat.
  useEffect(() => {
    if (thread.error instanceof ApiError && thread.error.status === 404) {
      setFresh(true);
      open(null);
    }
  }, [thread.error, open]);

  const saved = thread.data?.messages ?? [];
  const messages: Message[] = saved.map((message) => ({ ...message, ...extras[message.id] }));
  if (sending && sending.threadId === threadId) messages.push({ id: "sending", role: "user", text: sending.text });
  if (failure && failure.threadId === threadId && !sending)
    messages.push({ id: "failed", role: "error", text: failure.text });

  const send = useCallback(
    async (message: string) => {
      const target = threadId;
      const knownIds = new Set(history.map((entry) => entry.id));
      setFailure(null);
      setSending({ threadId: target, text: message });
      try {
        const reply = await latest.current.sendMessage(message, target ?? undefined);
        const adopted = reply.threadId ?? target;
        const extra = latest.current.options.decorate?.(reply);
        if (extra && reply.messageId) {
          const messageId = reply.messageId;
          setExtras((all) => ({ ...all, [messageId]: extra }));
        }
        latest.current.options.onReply?.(reply);
        if (adopted) {
          await client.fetchQuery({
            queryKey: queryKeys.chatThread(kind, key, adopted),
            queryFn: () => api.chats.get(kind, key, adopted),
            staleTime: 0,
          });
          if (adopted !== target) {
            setFresh(false);
            open(adopted);
          }
        }
        void client.invalidateQueries({ queryKey: listKey });
      } catch (error) {
        // The server notes a failed turn in the thread, so reload it. A first message may have started a thread.
        let adopted = target;
        try {
          const fresh = await client.fetchQuery({
            queryKey: listKey,
            queryFn: () => api.chats.list(kind, key),
            staleTime: 0,
          });
          adopted = target ?? fresh.find((entry) => !knownIds.has(entry.id))?.id ?? null;
          if (adopted) {
            const id = adopted;
            const reloaded = await client.fetchQuery({
              queryKey: queryKeys.chatThread(kind, key, id),
              queryFn: () => api.chats.get(kind, key, id),
              staleTime: 0,
            });
            if (adopted !== target) {
              setFresh(false);
              open(adopted);
            }
            if (reloaded.messages.at(-1)?.role === "error") return;
          }
        } catch {
          /* Fall through to the message below. */
        }
        setFailure({
          threadId: adopted,
          text: error instanceof Error ? error.message : "That didn't work. Please try again.",
        });
      } finally {
        setSending(null);
      }
    },
    [threadId, history, client, kind, key, open, listKey],
  );

  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.text;
  const retry = useCallback(() => {
    if (lastUser) void send(lastUser);
  }, [lastUser, send]);
  const newChat = useCallback(() => {
    setFresh(true);
    setFailure(null);
    open(null);
  }, [open]);
  const select = useCallback(
    (id: string) => {
      setFresh(false);
      setFailure(null);
      open(id);
    },
    [open],
  );
  const remove = useCallback(
    async (id: string) => {
      await api.chats.remove(kind, key, id);
      client.removeQueries({ queryKey: queryKeys.chatThread(kind, key, id) });
      const rest = (
        await client.fetchQuery({ queryKey: listKey, queryFn: () => api.chats.list(kind, key), staleTime: 0 })
      ).filter((entry) => entry.id !== id);
      if (id !== threadId) return;
      if (rest[0]) select(rest[0].id);
      else newChat();
    },
    [client, kind, key, listKey, threadId, select, newChat],
  );

  const current = history.find((entry) => entry.id === threadId);
  return {
    kind,
    key,
    threadId,
    title: thread.data?.title || current?.title || "",
    messages,
    loading: list.isPending || (!!threadId && thread.isPending),
    pending: sending !== null,
    history,
    draftKey: `chat:${kind}:${key}:${threadId ?? "new"}`,
    send,
    retry,
    newChat,
    select,
    remove,
  };
}
