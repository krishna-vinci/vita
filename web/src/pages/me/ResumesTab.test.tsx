import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ApiError, api, qualityApi } from "@/api/client";
import ResumesTab from "./ResumesTab";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const master = { id: "master", name: "Master", kind: "master", done: true, pdfUrl: null } as const;
const base = { id: "ai-backend", name: "AI backend", kind: "base", done: true, pdfUrl: null } as const;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ResumesTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function stubLists(archived: (typeof base)[]) {
  vi.spyOn(api.resumes, "list").mockImplementation(async (_signal, filter) =>
    filter === "only" ? [...archived] : [master, base],
  );
  vi.spyOn(api.jobs, "list").mockResolvedValue([]);
  vi.spyOn(api, "workspace").mockResolvedValue({ name: "w", hasOutline: true, resumes: [], applications: [] } as never);
}

it("archives a base from its menu, and the master has no menu", async () => {
  stubLists([]);
  const archive = vi.spyOn(api.resumes, "archive").mockResolvedValue({ sha: null });
  mount();
  await screen.findByText("AI backend");
  expect(screen.queryByRole("button", { name: /More for Master/ })).toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: "More for AI backend" }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Archive/ }));
  await waitFor(() => expect(archive).toHaveBeenCalledWith("ai-backend", expect.anything()));
});

it("lists archived bases, restores one and confirms before deleting", async () => {
  stubLists([base]);
  const restore = vi.spyOn(api.resumes, "unarchive").mockResolvedValue({ sha: null });
  const remove = vi.spyOn(api.resumes, "remove").mockResolvedValue({ deleted: true, sha: null });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Archived \(1\)/ }));
  fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
  await waitFor(() => expect(restore).toHaveBeenCalledWith("ai-backend", expect.anything()));
  fireEvent.click(screen.getByRole("button", { name: /Delete permanently/ }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/stays in your workspace's git history/)).toBeTruthy();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("ai-backend", expect.anything()));
});

it("names the jobs that still use a base and keeps the dialog open", async () => {
  stubLists([base]);
  vi.spyOn(api.resumes, "remove").mockRejectedValue(
    new ApiError(409, "base-in-use", "In use", undefined, { applications: [{ id: "acme-sre", title: "SRE at Acme" }] }),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Archived \(1\)/ }));
  fireEvent.click(screen.getByRole("button", { name: /Delete permanently/ }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
  const link = await within(dialog).findByRole("link", { name: "SRE at Acme" });
  expect(link.getAttribute("href")).toBe("/jobs/acme-sre");
});

const dates = { id: "dates.vita", text: "When did you work on Vita?", kind: "dates", target: "vita" } as const;

it("asks for missing facts before a Rewrite; Continue saves the answers, then generates", async () => {
  stubLists([]);
  vi.spyOn(qualityApi.facts, "missing").mockResolvedValue({ questions: [dates] });
  const answer = vi.spyOn(qualityApi.facts, "answer").mockResolvedValue({ questions: [], shas: [] });
  const generate = vi.spyOn(api.resumes, "generateMaster").mockResolvedValue({ job: { id: "j1" } } as never);
  mount();
  await screen.findByText("AI backend");
  fireEvent.click(screen.getByRole("button", { name: /Rewrite/ }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("A few details make this stronger")).toBeTruthy();
  expect(generate).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText("From year"), { target: { value: "2024" } });
  fireEvent.click(within(dialog).getByLabelText("Ongoing"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(generate).toHaveBeenCalled());
  expect(answer).toHaveBeenCalledWith({ answers: { "dates.vita": "2024 – Present" } }, expect.anything());
  expect(answer.mock.invocationCallOrder[0] ?? 0).toBeLessThan(generate.mock.invocationCallOrder[0] ?? 0);
});

it("Skip for now generates without answers and is remembered for the session", async () => {
  stubLists([]);
  const missing = vi.spyOn(qualityApi.facts, "missing").mockResolvedValue({ questions: [dates] });
  const answer = vi.spyOn(qualityApi.facts, "answer").mockResolvedValue({ questions: [], shas: [] });
  const generate = vi.spyOn(api.resumes, "generateMaster").mockResolvedValue({ job: { id: "j1" } } as never);
  mount();
  await screen.findByText("AI backend");
  fireEvent.click(screen.getByRole("button", { name: /Rewrite/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Skip for now" }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  expect(answer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Rewrite/ }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  expect(missing).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("generates straight away when nothing is missing", async () => {
  stubLists([]);
  vi.spyOn(qualityApi.facts, "missing").mockResolvedValue({ questions: [] });
  const generate = vi.spyOn(api.resumes, "generateMaster").mockResolvedValue({ job: { id: "j1" } } as never);
  mount();
  await screen.findByText("AI backend");
  fireEvent.click(screen.getByRole("button", { name: /Rewrite/ }));
  await waitFor(() => expect(generate).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a new base asks for missing facts first too", async () => {
  stubLists([]);
  vi.spyOn(qualityApi.facts, "missing").mockResolvedValue({ questions: [dates] });
  vi.spyOn(api, "packs").mockResolvedValue([]);
  const create = vi.spyOn(api.resumes, "create").mockResolvedValue({ job: { id: "j2" } } as never);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /New base resume/ }));
  fireEvent.change(await screen.findByLabelText("What direction is it for?"), { target: { value: "AI backend 2" } });
  fireEvent.click(screen.getByRole("button", { name: "Write it" }));
  const facts = (await screen.findByText("A few details make this stronger")).closest("[role=dialog]");
  expect(facts).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(within(facts as HTMLElement).getByRole("button", { name: "Skip for now" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
});
