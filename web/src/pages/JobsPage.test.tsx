import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
