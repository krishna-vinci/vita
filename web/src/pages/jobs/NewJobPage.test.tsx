import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import NewJobPage from "./NewJobPage";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

it("shows instructions by default and sends them with the job text", async () => {
  vi.spyOn(api, "workspace").mockResolvedValue({ name: "w", hasOutline: true, resumes: [], applications: [] } as never);
  vi.spyOn(api.resumes, "list").mockResolvedValue([]);
  const create = vi.spyOn(api.applications, "create").mockResolvedValue({ job: { id: "j1" } } as never);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <NewJobPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const instructions = await screen.findByLabelText("Instructions for this resume");
  fireEvent.change(screen.getByLabelText("Job description"), { target: { value: "We need an SRE" } });
  fireEvent.change(instructions, { target: { value: " Keep it to one page. " } });
  fireEvent.click(screen.getByRole("button", { name: "Make my resume" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0]?.[0]).toEqual({
    jobText: "We need an SRE",
    instructions: "Keep it to one page.",
    baseId: undefined,
  });
});

const wrap = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

it("keeps the typed job text, instructions and base across a remount", async () => {
  vi.spyOn(api, "workspace").mockResolvedValue({ name: "w", hasOutline: true, resumes: [], applications: [] } as never);
  vi.spyOn(api.resumes, "list").mockResolvedValue([]);
  const first = render(wrap(<NewJobPage />));
  fireEvent.change(await screen.findByLabelText("Job description"), { target: { value: "We need an SRE" } });
  fireEvent.change(screen.getByLabelText("Instructions for this resume"), { target: { value: "One page." } });
  first.unmount();

  render(wrap(<NewJobPage />));
  expect(((await screen.findByLabelText("Job description")) as HTMLTextAreaElement).value).toBe("We need an SRE");
  expect((screen.getByLabelText("Instructions for this resume") as HTMLTextAreaElement).value).toBe("One page.");
});

it("clears the kept text once the resume is made", async () => {
  vi.spyOn(api, "workspace").mockResolvedValue({ name: "w", hasOutline: true, resumes: [], applications: [] } as never);
  vi.spyOn(api.resumes, "list").mockResolvedValue([]);
  vi.spyOn(api.applications, "create").mockResolvedValue({ job: { id: "j1" } } as never);
  vi.spyOn(api.jobs, "get").mockResolvedValue({
    id: "j1",
    status: "done",
    result: { id: "acme" },
    progress: "done",
  } as never);
  const router = createMemoryRouter(
    [
      { path: "/jobs/new", element: <NewJobPage /> },
      { path: "/jobs/:id", element: <p>the resume</p> },
    ],
    { initialEntries: ["/jobs/new"] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText("Job description"), { target: { value: "We need an SRE" } });
  expect(sessionStorage.getItem("vita:draft:new-job:text")).toBe("We need an SRE");
  fireEvent.click(screen.getByRole("button", { name: "Make my resume" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/jobs/acme"));
  expect(sessionStorage.getItem("vita:draft:new-job:text")).toBeNull();
});
