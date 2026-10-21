import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import WorkspacePage from "./WorkspacePage";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.matchMedia ??= (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as never;
});
beforeEach(() => {
  vi.spyOn(api.jobs, "list").mockResolvedValue([]);
  vi.spyOn(api.resumes, "list").mockResolvedValue([]);
  vi.spyOn(api.outline, "get").mockResolvedValue({ markdown: "", hash: "", sha: null } as never);
  vi.spyOn(api.projects, "get").mockResolvedValue({ markdown: "", hash: "", sha: null } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* Not available. */
  }
});

const analysis = {
  title: "Site Reliability Engineer",
  company: "Acme",
  summary: "",
  requirements: [],
  baseScores: [],
} as never;
const asking = {
  status: "needs-answers",
  resume: null,
  pdfUrl: null,
  hash: "",
  review: null,
  jobText: "We need an SRE",
  notes: "",
  analysis,
  gaps: ["req-k8s: Have you used Kubernetes?", "ownership.newsy: What was your role in Newsy?"],
  answers: {},
} as never;
const drafted = {
  status: "draft",
  resume: {
    id: "job",
    kind: "job",
    parent: "master",
    template: "rover-base",
    layout: {},
    header: { name: "Ada Lovelace", contact: [] },
    sections: [],
  },
  pdfUrl: null,
  hash: "h",
  review: {
    round: 1,
    lint: [],
    checks: [],
    ats: [],
    render: null,
    gaps: [],
    overrides: [],
    done: true,
    blocking: [],
    suggestions: ["Add a number for the uptime work."],
  },
  jobText: "We need an SRE",
  notes: "",
  analysis,
  gaps: [],
  answers: {},
} as never;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/jobs/acme"]}>
        <Routes>
          <Route path="/jobs/:id" element={<WorkspacePage scope="application" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const queued = { job: { id: "j1" }, sha: null } as never;

it("shows the questions step, not the editor or a PDF button, while answers are missing", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue(asking);
  mount();
  await screen.findByText("A few questions before I write");
  expect(screen.getByText("Site Reliability Engineer at Acme")).toBeTruthy();
  expect(screen.getByText(/Nothing is guessed/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Write my resume" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  expect(screen.queryByText(/PDF/)).toBeNull();
  expect(screen.queryByText(/Ask for a change/)).toBeNull();
});

it("posts answers in the backend format, with ownership as a role and what they did", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue({
    ...(asking as object),
    gaps: [
      "req-k8s: Have you used Kubernetes?",
      "ownership.newsy: What was your role in Newsy?",
      "ownership.vita: What was your role in Vita?",
    ],
  } as never);
  const send = vi.spyOn(api.applications, "answers").mockResolvedValue(queued);
  const remember = vi.spyOn(api.projects, "setRelationship").mockResolvedValue({} as never);
  mount();
  await screen.findByText("A few questions before I write");
  fireEvent.click(screen.getByRole("button", { name: "Yes, I have" }));
  fireEvent.change(screen.getByLabelText(/Where and what/), { target: { value: "ran it" } });
  const [newsy, vita] = screen.getAllByRole("group").slice(1);
  fireEvent.click(within(newsy as HTMLElement).getByLabelText("Team member"));
  fireEvent.change(screen.getByLabelText("What did you build or own?"), { target: { value: "built the importer" } });
  fireEvent.click(within(vita as HTMLElement).getByLabelText("Sole developer"));
  fireEvent.click(screen.getByRole("button", { name: "Write my resume" }));
  await waitFor(() => expect(send).toHaveBeenCalled());
  expect(send).toHaveBeenCalledWith("acme", {
    answers: {
      "req-k8s": "Yes: ran it",
      "ownership.newsy": "team: built the importer",
      "ownership.vita": "sole",
    },
  });
  expect(remember).toHaveBeenCalledTimes(2);
  expect(remember).toHaveBeenCalledWith("newsy", { relationship: "team", contribution: "built the importer" });
  expect(remember).toHaveBeenCalledWith("vita", { relationship: "sole" });
  const order = [remember.mock.invocationCallOrder[0] ?? 0, send.mock.invocationCallOrder[0] ?? 0];
  expect(order[0]).toBeLessThan(order[1] ?? 0);
});

it("does not remember the role when the box is unchecked, and still sends the answer if remembering fails", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue(asking);
  const send = vi.spyOn(api.applications, "answers").mockResolvedValue(queued);
  const remember = vi.spyOn(api.projects, "setRelationship").mockRejectedValue(new Error("busy"));
  mount();
  await screen.findByText("A few questions before I write");
  fireEvent.click(screen.getByLabelText("Lead"));
  fireEvent.click(screen.getByRole("button", { name: "Write my resume" }));
  await waitFor(() => expect(send).toHaveBeenCalled());
  expect(remember).toHaveBeenCalledWith("newsy", { relationship: "lead" });
  expect(send).toHaveBeenCalledWith("acme", { answers: { "ownership.newsy": "lead" } });

  cleanup();
  remember.mockClear();
  mount();
  await screen.findByText("A few questions before I write");
  fireEvent.click(screen.getByLabelText("Lead"));
  fireEvent.click(screen.getByLabelText("Remember for this project"));
  fireEvent.click(screen.getByRole("button", { name: "Write my resume" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(remember).not.toHaveBeenCalled();
});

it("Skip and write now asks the backend to write with the open questions skipped", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue(asking);
  const write = vi.spyOn(api.applications, "write").mockResolvedValue(queued);
  mount();
  await screen.findByText("A few questions before I write");
  fireEvent.click(screen.getByRole("button", { name: "Skip and write now" }));
  await waitFor(() => expect(write).toHaveBeenCalledWith("acme", { skip: true }));
});

it("shows the failure with a retry that repeats the same call", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue(asking);
  const write = vi.spyOn(api.applications, "write").mockResolvedValue(queued);
  vi.spyOn(api.jobs, "list").mockResolvedValue([
    { id: "j0", resourceId: "acme", status: "failed", error: "Model unavailable", createdAt: "2026-10-21", usage: [] },
  ] as never);
  mount();
  await screen.findByText("Model unavailable");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Skip and write now" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
});

it("shows progress while the job runs", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue(asking);
  vi.spyOn(api.jobs, "list").mockResolvedValue([
    { id: "j1", resourceId: "acme", status: "running", progress: "write", createdAt: "2026-10-21", usage: [] },
  ] as never);
  mount();
  await screen.findByText("Writing your resume");
  expect(screen.queryByRole("button", { name: "Write my resume" })).toBeNull();
});

it("shows suggestions on a drafted resume without blocking Download", async () => {
  vi.spyOn(api.applications, "get").mockResolvedValue(drafted);
  try {
    localStorage.setItem("vita:details", "1");
  } catch {
    /* Details just start closed. */
  }
  mount();
  const summary = await screen.findByText(/Could strengthen this resume \(1\)/);
  expect(summary.closest("details")?.textContent).toContain("Add a number for the uptime work.");
  expect((screen.getByRole("button", { name: /Download/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText("A few questions before I write")).toBeNull();
});
