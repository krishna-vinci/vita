import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RecruiterReview } from "@vita/shared";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api, qualityApi } from "@/api/client";
import { RecruiterCard } from "./RecruiterCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const ops = [{ op: "bullet.edit", id: "b1", text: "Led results first." }];
const question = { id: "dates.vita", text: "When did you work on Vita?", kind: "dates", target: "vita" };
const review = {
  score: 7,
  summary: "Clear, but short on results.",
  findings: [
    { id: "f-low", area: "order", severity: "low", message: "Move skills up.", fix: { ops } },
    { id: "f-high", area: "results", severity: "high", message: "No numbers anywhere." },
    { id: "f-ask", area: "timeline", severity: "medium", message: "Vita has no dates.", fix: { question } },
    { id: "f-mid", area: "wording", severity: "medium", message: "Open with the outcome.", fix: { ops } },
  ],
} as unknown as RecruiterReview;

function mount(value: RecruiterReview | null = review, onUndo = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RecruiterCard
        scope="application"
        id="acme"
        review={value ?? undefined}
        instructions="Keep it short."
        onUndo={onUndo}
      />
    </QueryClientProvider>,
  );
  return onUndo;
}

it("renders nothing without a recruiter review", () => {
  mount(null);
  expect(screen.queryByLabelText("Recruiter review")).toBeNull();
});

it("shows the score and the top three findings, high first, and expands to all", () => {
  mount();
  const card = screen.getByLabelText("Recruiter review");
  expect(card.textContent).toContain("Score 7/10");
  expect(card.textContent).toContain("Clear, but short on results.");
  expect(card.querySelector(".text-warning")?.textContent).toBe("7");
  const items = within(card).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]?.textContent).toContain("No numbers anywhere.");
  expect(items[1]?.textContent).toContain("Vita has no dates.");
  expect(card.textContent).not.toContain("Move skills up.");
  fireEvent.click(screen.getByRole("button", { name: /See all \(4\)/ }));
  expect(within(card).getAllByRole("listitem")).toHaveLength(4);
});

it("colours the score by band", () => {
  for (const [score, tone] of [
    [9, "text-success"],
    [5, "text-destructive"],
  ] as const) {
    mount({ ...review, score });
    expect(screen.getByLabelText("Recruiter review").querySelector(`.${tone}`)?.textContent).toBe(String(score));
    cleanup();
  }
});

it("applies a finding with ops, toasts Undo that undoes, and hides the finding", async () => {
  const apply = vi.spyOn(qualityApi, "applyFinding").mockResolvedValue({} as never);
  const success = vi.spyOn(toast, "success");
  const undo = mount();
  const item = screen.getByText("Open with the outcome.").closest("li") as HTMLElement;
  fireEvent.click(within(item).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith("application", "acme", "f-mid"));
  await waitFor(() => expect(success).toHaveBeenCalled());
  const [message, options] = success.mock.calls[0] ?? [];
  expect(message).toBe("Applied");
  expect((options as unknown as { action: { label: string } }).action.label).toBe("Undo");
  expect(screen.queryByText("Open with the outcome.")).toBeNull();
  (options as unknown as { action: { onClick: () => void } }).action.onClick();
  expect(undo).toHaveBeenCalled();
  // Undo brings the finding back.
  expect(await screen.findByText("Open with the outcome.")).toBeTruthy();
});

it("opens the answer input for a question finding and posts it to the facts route", async () => {
  const answer = vi.spyOn(qualityApi.facts, "answer").mockResolvedValue({ questions: [], shas: [] });
  const regenerate = vi.spyOn(api.applications, "regenerate").mockResolvedValue({ job: { id: "j1" } } as never);
  mount();
  const item = screen.getByText("Vita has no dates.").closest("li") as HTMLElement;
  expect(within(item).queryByRole("button", { name: "Apply" })).toBeNull();
  fireEvent.click(within(item).getByRole("button", { name: "Answer" }));
  fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2024" } });
  fireEvent.click(screen.getByLabelText("Ongoing"));
  fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
  await waitFor(() =>
    expect(answer).toHaveBeenCalledWith({ answers: { "dates.vita": "2024 – Present" } }, expect.anything()),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Regenerate to use this/ }));
  await waitFor(() => expect(regenerate).toHaveBeenCalledWith("acme", { instructions: "Keep it short." }));
});

it("opens Answer when applying says an answer is required", async () => {
  vi.spyOn(qualityApi, "applyFinding").mockRejectedValue(
    new ApiError(409, "answer-required", "Answer this question", undefined, { question }),
  );
  mount({
    ...review,
    findings: [{ id: "f-x", area: "timeline", severity: "high", message: "Needs dates.", fix: { ops } }],
  } as unknown as RecruiterReview);
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByLabelText("From year")).toBeTruthy();
});

it("shows why an apply failed and keeps the finding", async () => {
  vi.spyOn(qualityApi, "applyFinding").mockRejectedValue(new ApiError(409, "stale", "The resume changed."));
  mount();
  const item = screen.getByText("Open with the outcome.").closest("li") as HTMLElement;
  fireEvent.click(within(item).getByRole("button", { name: "Apply" }));
  expect(await within(item).findByRole("alert")).toBeTruthy();
  expect(within(item).getByRole("alert").textContent).toBe("The resume changed.");
});

it("remembers a dismissed finding across a remount", () => {
  mount();
  fireEvent.click(
    within(screen.getByText("No numbers anywhere.").closest("li") as HTMLElement).getByRole("button", {
      name: "Dismiss",
    }),
  );
  expect(screen.queryByText("No numbers anywhere.")).toBeNull();
  expect(JSON.parse(localStorage.getItem("vita:dismissed-findings:application:acme") ?? "[]")).toEqual(["f-high"]);
  cleanup();
  mount();
  expect(screen.queryByText("No numbers anywhere.")).toBeNull();
  expect(screen.getByText("Vita has no dates.")).toBeTruthy();
});
