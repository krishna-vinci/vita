import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
