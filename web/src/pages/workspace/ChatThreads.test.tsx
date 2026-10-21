import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatThread } from "@vita/shared";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { useSavedChat } from "@/lib/use-chat-thread";
import { SourceChat } from "../me/SourceChat";
import { ChatPanel } from "./ChatPanel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(cleanup);

const now = new Date().toISOString();
const thread = (id: string, title: string, messages: ChatThread["messages"] = []): ChatThread => ({
  id,
  kind: "resume",
  key: "ai",
  title,
  createdAt: now,
  updatedAt: now,
  messages,
});
const message = (id: string, role: "user" | "assistant" | "error", text: string, rest = {}) => ({
  id,
  role,
  text,
  at: now,
  ...rest,
});
const first = thread("t-new", "Shorten the summary", [
  message("m1", "user", "Shorten the summary"),
  message("m2", "assistant", "Done, it is shorter.", {
    changes: [{ id: "b1", before: "A long old summary", after: "A short summary", hidden: false }],
  }),
]);
const older = thread("t-old", "Lead with backend", [message("m3", "user", "Lead with backend")]);
const summaries = [first, older].map(({ id, title, updatedAt, messages }) => ({
  id,
  title,
  updatedAt,
  messageCount: messages.length,
}));

function Host({
  reply,
}: {
  reply?: (message: string, threadId?: string) => Promise<{ threadId?: string; messageId?: string }>;
}) {
  const chat = useSavedChat("resume", "ai", reply ?? (async () => ({ threadId: "t-new", messageId: "m9" })));
  return <ChatPanel chat={chat} intro="Here is your resume." />;
}

function mount(element: React.ReactNode = <Host />, path = "/me/resumes/ai") {
  const router = createMemoryRouter([{ path: "/me/resumes/:id", element }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
const openHistory = async () =>
  fireEvent.pointerDown(await screen.findByRole("button", { name: "History" }), { button: 0, ctrlKey: false });

beforeEach(() => {
  vi.spyOn(api.chats, "list").mockResolvedValue(summaries);
  vi.spyOn(api.chats, "get").mockImplementation(async (_kind, _key, id) => (id === "t-old" ? older : first));
});

it("opens the newest saved thread, with its messages and past changes, and puts it in the URL", async () => {
  const router = mount();
  expect(await screen.findByText("Done, it is shorter.")).toBeTruthy();
  expect(screen.getByText("A long old summary")).toBeTruthy();
  expect(screen.getByText("A short summary")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Shorten the summary" })).toBeTruthy();
  await waitFor(() => expect(router.state.location.search).toBe("?thread=t-new"));
});

it("opens the thread named in the URL, not the newest", async () => {
  mount(<Host />, "/me/resumes/ai?thread=t-old");
  expect(await screen.findByText("Lead with backend", { selector: "div" })).toBeTruthy();
});

it("sends with the open thread's id", async () => {
  const reply = vi.fn().mockResolvedValue({ threadId: "t-new", messageId: "m9" });
  mount(<Host reply={reply} />);
  await screen.findByText("Done, it is shorter.");
  fireEvent.change(screen.getByLabelText("Ask for a change"), { target: { value: "Make it punchier" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(reply).toHaveBeenCalledWith("Make it punchier", "t-new"));
});

it("starts a new chat without a thread, then adopts the id the server returns", async () => {
  const reply = vi.fn().mockResolvedValue({ threadId: "t-fresh", messageId: "m9" });
  vi.spyOn(api.chats, "get").mockImplementation(async (_k, _key, id) =>
    id === "t-fresh" ? thread("t-fresh", "Hello", [message("n1", "user", "Hello")]) : first,
  );
  const router = mount(<Host reply={reply} />);
  await screen.findByText("Done, it is shorter.");
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(await screen.findByRole("heading", { name: "New chat" })).toBeTruthy();
  expect(screen.queryByText("Done, it is shorter.")).toBeNull();
  expect(router.state.location.search).toBe("");
  fireEvent.change(screen.getByLabelText("Ask for a change"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(reply).toHaveBeenCalledWith("Hello", undefined));
  await waitFor(() => expect(router.state.location.search).toBe("?thread=t-fresh"));
});

it("switches threads from History and updates ?thread=", async () => {
  const router = mount();
  await screen.findByText("Done, it is shorter.");
  await openHistory();
  fireEvent.click(await screen.findByRole("menuitem", { name: /^Lead with backend/ }));
  await waitFor(() => expect(router.state.location.search).toBe("?thread=t-old"));
  expect(await screen.findByRole("heading", { name: "Lead with backend" })).toBeTruthy();
});

it("deletes a thread only after confirmation, then moves to the newest left", async () => {
  const remove = vi.spyOn(api.chats, "remove").mockResolvedValue(undefined);
  const router = mount();
  await screen.findByText("Done, it is shorter.");
  await openHistory();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete chat Shorten the summary" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(remove).not.toHaveBeenCalled();
  vi.spyOn(api.chats, "list").mockResolvedValue(summaries.slice(1));
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("resume", "ai", "t-new"));
  await waitFor(() => expect(router.state.location.search).toBe("?thread=t-old"));
});

it("shows a saved error with Retry that sends the last thing said again", async () => {
  const failed = thread("t-new", "Shorten", [
    message("m1", "user", "Shorten it"),
    message("m2", "error", "Model unavailable"),
  ]);
  vi.spyOn(api.chats, "get").mockResolvedValue(failed);
  const reply = vi.fn().mockResolvedValue({ threadId: "t-new", messageId: "m9" });
  mount(<Host reply={reply} />);
  expect(await screen.findByText("Model unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(reply).toHaveBeenCalledWith("Shorten it", "t-new"));
});

const proposal = {
  file: "outline" as const,
  before: "old line",
  after: "new line",
  summary: "Update the line",
  baseHash: "a".repeat(64),
};
const sourceThread = (applied: boolean): ChatThread => ({
  ...thread("s1", "Fix a line"),
  kind: "source",
  key: "outline-projects",
  messages: [
    message("sm1", "user", "Fix a line"),
    message("sm2", "assistant", "Here is a change.", { proposal, ...(applied ? { applied: true } : {}) }),
  ],
});
const sourceList = [{ id: "s1", title: "Fix a line", updatedAt: now, messageCount: 2 }];

it("shows a past applied proposal as added, with no Accept button", async () => {
  vi.spyOn(api.chats, "list").mockResolvedValue(sourceList);
  vi.spyOn(api.chats, "get").mockResolvedValue(sourceThread(true));
  mount(<SourceChat dirty={false} />);
  expect(await screen.findByText("Added.")).toBeTruthy();
  expect(screen.getByText("new line")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
});

it("accepts a fresh proposal with its message and thread ids", async () => {
  vi.spyOn(api.chats, "list").mockResolvedValue(sourceList);
  vi.spyOn(api.chats, "get").mockResolvedValue(sourceThread(false));
  const apply = vi.spyOn(api.chat, "applySource").mockResolvedValue({} as never);
  mount(<SourceChat dirty={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith(proposal, { messageId: "sm2", threadId: "s1" }));
  expect(await screen.findByText("Added.")).toBeTruthy();
});

it("says a stale proposal is out of date and disables Accept", async () => {
  vi.spyOn(api.chats, "list").mockResolvedValue(sourceList);
  vi.spyOn(api.chats, "get").mockResolvedValue(sourceThread(false));
  vi.spyOn(api.chat, "applySource").mockRejectedValue(new ApiError(409, "stale-hash", "Source changed"));
  mount(<SourceChat dirty={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  expect(await screen.findByText("This suggestion is out of date. Ask again.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(true);
});
