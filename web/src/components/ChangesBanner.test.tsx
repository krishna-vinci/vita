import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { ChangesBanner } from "./ChangesBanner";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
});

function mount(props: { resumeId?: string; showLines?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ChangesBanner {...props} />
    </QueryClientProvider>,
  );
}

const stale = [
  { id: "ops", kind: "base", parent: "master", reason: "outline changed" },
  { id: "acme", kind: "job", parent: "ops", reason: "master changed" },
] as const;

const line = (resumeId: string, over: Record<string, unknown> = {}) => ({
  resumeId,
  kind: "update",
  bulletId: "b1",
  claimId: "c1",
  before: "Ran nightly backups",
  after: "Ran nightly backups to S3",
  reason: "outline changed",
  locked: false,
  ...over,
});

function seed({ status = [], suggestions = [] }: { status?: unknown[]; suggestions?: unknown[] }) {
  vi.spyOn(api.resumes, "list").mockResolvedValue([{ id: "ops", name: "Ops base", kind: "base" }] as never);
  vi.spyOn(api.applications, "list").mockResolvedValue([{ id: "acme", title: "SRE", company: "Acme" }] as never);
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: status } as never);
  vi.spyOn(api.sync, "suggestions").mockResolvedValue(suggestions as never);
}

it("is hidden when no resume is stale and no line can change", async () => {
  seed({});
  mount();
  await waitFor(() => expect(api.sync.suggestions).toHaveBeenCalled());
  await waitFor(() => expect(api.sync.status).toHaveBeenCalled());
  expect(document.body.textContent).toBe("");
});

it("shows the stale count and Update resumes posts the cascade", async () => {
  seed({ status: [...stale] });
  const cascade = vi.spyOn(api.sync, "cascade").mockResolvedValue({ jobIds: ["j1", "j2"] });
  const success = vi.spyOn(toast, "success");
  mount();
  expect(await screen.findByText("Your information changed.")).toBeTruthy();
  expect(screen.getByText(/2 resumes are out of date\./)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Review line changes/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Update resumes" }));
  await waitFor(() => expect(cascade).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(success).toHaveBeenCalledWith("Updating 2 resumes…"));
});

it("shows the busy toast when the cascade is refused with a 409", async () => {
  seed({ status: [...stale] });
  vi.spyOn(api.sync, "cascade").mockRejectedValue(new ApiError(409, "workspace-busy", "busy"));
  const error = vi.spyOn(toast, "error");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Update resumes" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith("Vita is busy. Try again when the current job finishes."));
});

it("shows the line-changes link and opens the review, applying only the picked lines", async () => {
  seed({
    suggestions: [line("ops"), line("ops", { bulletId: "b2", claimId: "c2", locked: true, after: "Kept as written" })],
  });
  const apply = vi.spyOn(api.sync, "apply").mockResolvedValue({ sha: null } as never);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Review line changes (2)" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Updates from your outline")).toBeTruthy();
  expect(within(dialog).getByRole("heading", { name: "Ops base" })).toBeTruthy();
  expect(within(dialog).getByText("Ran nightly backups to S3")).toBeTruthy();
  expect(within(dialog).getByText(/stays as it is unless you tick it/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply 1 change" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]?.[0]).toMatchObject({ picks: [expect.objectContaining({ bulletId: "b1" })] });
});

it("in a workspace, shows only this resume: its stale entry as Update and its line changes", async () => {
  seed({
    status: [...stale],
    suggestions: [line("acme"), line("ops")],
  });
  mount({ resumeId: "acme", showLines: true });
  expect(await screen.findByText("This resume is out of date")).toBeTruthy();
  expect(screen.getByText("(master changed)")).toBeTruthy();
  expect(screen.queryByText(/out of date\./)).toBeNull();
  expect(screen.queryByRole("button", { name: "Update resumes" })).toBeNull();
  expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Review line changes (1)" })).toBeTruthy();
});

it("in a workspace without line suggestions, shows no line-changes link", async () => {
  seed({ status: [...stale], suggestions: [line("acme")] });
  mount({ resumeId: "acme", showLines: false });
  expect(await screen.findByText("This resume is out of date")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Review line changes/ })).toBeNull();
});
