import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import JobsPage from "./JobsPage";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("shows a calm empty state linked to the new job route", async () => {
  vi.spyOn(api.applications, "list").mockResolvedValue([]);
  mount();
  await screen.findByText("Your next opportunity starts here");
  expect(screen.getByRole("link", { name: "Start a job resume" }).getAttribute("href")).toBe("/jobs/new");
});
it("renders applications as text with review status and detail links", async () => {
  vi.spyOn(api.applications, "list").mockResolvedValue([
    {
      id: "example",
      title: "<script>role</script>",
      company: "Example company",
      baseId: "master",
      status: "done",
      done: true,
      pdfUrl: null,
    },
  ]);
  mount();
  await screen.findByText("<script>role</script>");
  expect(screen.getByText("Ready to export")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Example company/ }).getAttribute("href")).toBe("/jobs/example");
  expect(document.querySelector("script")).toBeNull();
});
it("shows archived jobs with restore, and the delete dialog lists what goes", async () => {
  const gone = {
    id: "old",
    title: "Old role",
    company: "Old Co",
    baseId: "master",
    status: "done" as const,
    done: true,
    pdfUrl: null,
  };
  vi.spyOn(api.applications, "list").mockImplementation(async (_signal, filter) => (filter === "only" ? [gone] : []));
  const remove = vi.spyOn(api.applications, "remove").mockResolvedValue({ deleted: true, sha: null });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Archived \(1\)/ }));
  expect(screen.getByRole("button", { name: /Restore/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Delete permanently/ }));
  const dialog = await screen.findByRole("alertdialog");
  for (const text of ["the resume", "the cover letter", "interview prep", "the tracker card"])
    expect(within(dialog).getByText(text)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("old", expect.anything()));
});
it("marks a job that is waiting for answers, with a way in and no interview prep", async () => {
  vi.spyOn(api.applications, "list").mockResolvedValue([
    {
      id: "asking",
      title: "SRE",
      company: "Asking Co",
      baseId: null,
      status: "needs-answers",
      done: false,
      pdfUrl: null,
    },
  ]);
  mount();
  await screen.findAllByText("Needs your answers");
  expect(screen.queryByText("Needs review")).toBeNull();
  expect(screen.getAllByRole("link", { name: "Answer questions" })[0]?.getAttribute("href")).toBe("/jobs/asking");
  expect(screen.queryByRole("link", { name: /Interview prep/ })).toBeNull();
  expect(screen.queryByText(/PDF/)).toBeNull();
});
