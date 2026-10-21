import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { StaleBanner } from "./StaleBanner";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
});

function mount(resumeId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <StaleBanner resumeId={resumeId} />
    </QueryClientProvider>,
  );
}

const stale = [
  { id: "ops", kind: "base", parent: "master", reason: "outline changed" },
  { id: "acme", kind: "job", parent: "ops", reason: "master changed" },
] as const;

function seed() {
  vi.spyOn(api.resumes, "list").mockResolvedValue([{ id: "ops", name: "Ops base", kind: "base" }] as never);
  vi.spyOn(api.applications, "list").mockResolvedValue([{ id: "acme", title: "SRE", company: "Acme" }] as never);
}

it("renders the count and the first reason, and details name each resume", async () => {
  seed();
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [...stale] } as never);
  mount();
  await screen.findByText("2 resumes are out of date:");
  expect(screen.getByText("outline changed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Details/ }));
  expect(screen.getByText("Ops base")).toBeTruthy();
  expect(screen.getByText("SRE")).toBeTruthy();
});

it("Update all posts the cascade and reports how many resumes are updating", async () => {
  seed();
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [...stale] } as never);
  const cascade = vi.spyOn(api.sync, "cascade").mockResolvedValue({ jobIds: ["j1", "j2"] });
  const success = vi.spyOn(toast, "success");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
  await waitFor(() => expect(cascade).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(success).toHaveBeenCalledWith("Updating 2 resumes…"));
});

it("shows the busy toast on a 409", async () => {
  seed();
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [...stale] } as never);
  vi.spyOn(api.sync, "cascade").mockRejectedValue(new ApiError(409, "workspace-busy", "busy"));
  const error = vi.spyOn(toast, "error");
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith("Vita is busy. Try again when the current job finishes."));
});

it("shows only this resume's entry in a workspace", async () => {
  seed();
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [...stale] } as never);
  mount("acme");
  expect(await screen.findByText("This resume is out of date")).toBeTruthy();
  expect(screen.getByText("(master changed)")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Details/ })).toBeNull();
});

it("renders nothing when no resume is stale", async () => {
  seed();
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [] });
  mount();
  await waitFor(() => expect(api.sync.status).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Update all" })).toBeNull();
  expect(document.body.textContent).toBe("");
});
