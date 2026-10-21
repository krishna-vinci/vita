import { randomUUID } from "node:crypto";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileLocks, readText, relFromRoot, resolveInWorkspace, writeTextAtomic } from "@vita/core";
import {
  ChatKind,
  ChatMessage,
  ChatThread,
  type ChatThreadSummary,
  type ChatTurn,
  Slug,
  type SourceApplyRequest,
  SourceProposal,
} from "@vita/shared";
import { ApiFailure } from "./errors.js";

const locks = new FileLocks();
const newest = (a: ChatThread, b: ChatThread) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
type Reply = { reply: string } & Partial<
  Pick<ChatMessage, "changedBullets" | "changes" | "proposal" | "memoryProposals" | "applied">
>;

/** Working notes under .vita, deliberately never included in workspace git commits. */
export class ChatThreads {
  constructor(private readonly root: string) {}

  private folder(kind: ChatKind, key: string): string {
    ChatKind.parse(kind);
    Slug.parse(key);
    if ((kind === "source" && key !== "outline-projects") || (kind === "onboarding" && key !== "interview"))
      throw new ApiFailure(400, "invalid-input", "Invalid key for this chat kind");
    return `.vita/chats/${kind}/${key}`;
  }
  private file(kind: ChatKind, key: string, id: string): string {
    Slug.parse(id);
    return `${this.folder(kind, key)}/${id}.json`;
  }
  private async locked<T>(kind: ChatKind, key: string, action: () => Promise<T>): Promise<T> {
    const release = await locks.acquire(resolveInWorkspace(this.root, this.folder(kind, key)), "chat-thread");
    try {
      return await action();
    } finally {
      release();
    }
  }
  async get(kind: ChatKind, key: string, id: string): Promise<ChatThread> {
    const thread = ChatThread.parse(JSON.parse(await readText(this.root, this.file(kind, key, id))));
    if (thread.id !== id || thread.kind !== kind || thread.key !== key)
      throw new ApiFailure(404, "not-found", "Chat thread not found");
    return thread;
  }
  private async threads(kind: ChatKind, key: string): Promise<ChatThread[]> {
    const folder = this.folder(kind, key);
    let files: string[];
    try {
      files = await readdir(resolveInWorkspace(this.root, folder));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const threads: ChatThread[] = [];
    for (const file of files) {
      const id = file.endsWith(".json") ? file.slice(0, -5) : "";
      if (Slug.safeParse(id).success) threads.push(await this.get(kind, key, id));
    }
    return threads.sort(newest);
  }
  async list(kind: ChatKind, key: string): Promise<ChatThreadSummary[]> {
    return this.locked(kind, key, async () =>
      (await this.threads(kind, key)).map(({ id, title, updatedAt, messages }) => ({
        id,
        title,
        updatedAt,
        messageCount: messages.length,
      })),
    );
  }
  private async save(thread: ChatThread): Promise<void> {
    await writeTextAtomic(
      this.root,
      this.file(thread.kind, thread.key, thread.id),
      `${JSON.stringify(ChatThread.parse(thread))}\n`,
    );
  }
  async create(kind: ChatKind, key: string): Promise<ChatThread> {
    return this.locked(kind, key, async () => {
      const now = new Date().toISOString();
      const thread: ChatThread = {
        id: randomUUID(),
        kind,
        key,
        title: "",
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      // Prune existing notes first so an identical timestamp never evicts the new thread.
      for (const old of (await this.threads(kind, key)).slice(49))
        await rm(resolveInWorkspace(this.root, this.file(kind, key, old.id)));
      await this.save(thread);
      return thread;
    });
  }
  async delete(kind: ChatKind, key: string, id: string): Promise<void> {
    await this.locked(kind, key, async () => {
      await this.get(kind, key, id);
      await rm(resolveInWorkspace(this.root, this.file(kind, key, id)));
    });
  }
  async deleteKey(kind: ChatKind, key: string): Promise<void> {
    await this.locked(kind, key, async () => {
      const folder = this.folder(kind, key);
      const validate = async (rel: string): Promise<void> => {
        const absolute = resolveInWorkspace(this.root, rel);
        const stat = await lstat(path.join(this.root, rel));
        if (stat.isSymbolicLink() || relFromRoot(this.root, absolute) !== rel)
          throw new ApiFailure(403, "path-forbidden", "Cannot delete redirected chat notes");
        if (stat.isDirectory()) for (const name of await readdir(absolute)) await validate(`${rel}/${name}`);
      };
      try {
        await validate(folder);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      await rm(resolveInWorkspace(this.root, folder), { recursive: true });
    });
  }
  private async append(kind: ChatKind, key: string, id: string, message: ChatMessage): Promise<void> {
    await this.locked(kind, key, async () => {
      const thread = await this.get(kind, key, id);
      if (!thread.title && message.role === "user") thread.title = message.text.trim().slice(0, 60);
      thread.messages = [...thread.messages, message].slice(-200);
      thread.updatedAt = message.at;
      await this.save(thread);
    });
  }
  /** Call while holding the runtime's exclusive lock, covering the entire model turn. */
  async turn<T extends Reply>(
    kind: ChatKind,
    key: string,
    input: { threadId?: string; message: string },
    action: (history: ChatTurn[]) => Promise<T>,
  ): Promise<T & { threadId: string; messageId: string }> {
    const thread = input.threadId ? await this.get(kind, key, input.threadId) : await this.create(kind, key);
    const history = thread.messages
      .filter((m) => m.role !== "error")
      .slice(-10)
      .map((m) => ({ role: m.role as ChatTurn["role"], text: m.text }));
    await this.append(kind, key, thread.id, {
      id: randomUUID(),
      role: "user",
      text: input.message,
      at: new Date().toISOString(),
    });
    const messageId = randomUUID();
    let result: T;
    try {
      result = await action(history);
    } catch (error) {
      await this.append(kind, key, thread.id, {
        id: messageId,
        role: "error",
        text: (error instanceof Error ? error.message : "Chat failed").slice(0, 20_000),
        at: new Date().toISOString(),
      });
      throw error;
    }
    const reply = result.reply.slice(0, 20_000);
    await this.append(
      kind,
      key,
      thread.id,
      ChatMessage.parse({
        ...result,
        id: messageId,
        role: "assistant",
        text: reply,
        at: new Date().toISOString(),
      }),
    );
    return { ...result, reply, threadId: thread.id, messageId };
  }
  async apply<T>(
    kind: "source" | "onboarding",
    key: string,
    input: SourceApplyRequest,
    action: () => Promise<T>,
  ): Promise<T> {
    let saved: ChatThread | undefined;
    if (input.messageId) {
      const threads = input.threadId ? [await this.get(kind, key, input.threadId)] : await this.threads(kind, key);
      saved = threads.find((thread) => thread.messages.some((message) => message.id === input.messageId));
      const message = saved?.messages.find((message) => message.id === input.messageId);
      if (message?.role !== "assistant" || !message.proposal)
        throw new ApiFailure(404, "not-found", "Chat proposal not found");
      if (
        JSON.stringify(
          SourceProposal.parse({
            file: input.file,
            before: input.before,
            after: input.after,
            summary: input.summary,
            baseHash: input.baseHash,
          }),
        ) !== JSON.stringify(message.proposal)
      )
        throw new ApiFailure(409, "proposal-mismatch", "The request does not match the saved proposal");
    }
    const result = await action();
    if (saved) {
      const id = saved.id;
      await this.locked(kind, key, async () => {
        const thread = await this.get(kind, key, id);
        const message = thread.messages.find((message) => message.id === input.messageId);
        if (message) message.applied = true;
        thread.updatedAt = new Date().toISOString();
        await this.save(thread);
      });
    }
    return result;
  }
}
