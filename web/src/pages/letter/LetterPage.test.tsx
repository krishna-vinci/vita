import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import LetterPage from "./LetterPage";

const base = {
  review: {
    round: 1,
    lint: [{ rule: "unsourced-number", severity: "block", message: 'Number "40%"', bulletId: "p2" }],
    checks: [],
    ats: [],
    render: null,
    gaps: [],
    overrides: [],
    done: false,
    blocking: [],
    writerModel: "faux/writer",
    sourceHash: "",
    paragraphState: {},
  },
  hash: "h",
  pdfUrl: null,
};
const letter = {
  greeting: "Dear team,",
  paragraphs: [
    { id: "p1", text: "I build catalogue services.", claims: [], origin: "ai", locked: false },
    { id: "p2", text: "I cut errors by 40%.", claims: [], origin: "ai", locked: false },
  ],
  closing: "Sincerely,",
  signature: "Morgan Vale",
};
beforeEach(() => {
  vi.spyOn(api.applications, "get").mockResolvedValue({
    analysis: { title: "Engineer", company: "Acme", requirements: [], baseScores: [] },
  } as never);
  vi.spyOn(api.jobs, "list").mockResolvedValue([]);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/jobs/job-1/letter"]}>
        <Routes>
          <Route path="/jobs/:id/letter" element={<LetterPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the generate form when there is no letter yet", async () => {
  vi.spyOn(api.letters, "get").mockRejectedValue(new ApiError(404, "not-found", "none"));
  mount();
  await screen.findByRole("button", { name: "Write my cover letter" });
});

it("shows paragraphs as text and softly flags the one with an unsupported number", async () => {
  vi.spyOn(api.letters, "get").mockResolvedValue({ letter, ...base } as never);
  mount();
  await screen.findByText("I build catalogue services.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Question about this paragraph" })).toBeTruthy());
  expect(screen.getByText("Dear team,")).toBeTruthy();
});
