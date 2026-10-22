import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { emptyFact, type FactDraft, FactQuestion, factAnswer, factKindOf, factProblem, isFactId } from "./FactQuestion";

afterEach(cleanup);

function Harness({ kind, onDraft }: { kind: "dates" | "graduation" | "results"; onDraft: (draft: FactDraft) => void }) {
  const [draft, setDraft] = useState(emptyFact);
  return (
    <FactQuestion
      id={`${kind}.vita`}
      text="Question?"
      kind={kind}
      value={draft}
      onChange={(next) => {
        setDraft(next);
        onDraft(next);
      }}
    />
  );
}
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("knows fact ids by prefix", () => {
  expect(isFactId("dates.vita")).toBe(true);
  expect(isFactId("ownership.vita")).toBe(false);
  expect(factKindOf("graduation.bsc")).toBe("graduation");
  expect(factKindOf("req-k8s", "other")).toBe("other");
});

it("writes dates with Ongoing as 'Mon YYYY – Present'", () => {
  const seen = vi.fn();
  render(<Harness kind="dates" onDraft={seen} />);
  pick("From month", "Mar");
  pick("From year", "2024");
  fireEvent.click(screen.getByLabelText("Ongoing"));
  const last = seen.mock.calls.at(-1)?.[0] as FactDraft;
  expect(factAnswer("dates", last)).toBe("Mar 2024 – Present");
});

it("writes a closed date range and needs the end year unless Ongoing", () => {
  const draft = { ...emptyFact, fromYear: "2023", toMonth: "Aug", toYear: "2025" };
  expect(factAnswer("dates", draft)).toBe("2023 – Aug 2025");
  const open = { ...emptyFact, fromYear: "2023" };
  expect(factAnswer("dates", open)).toBeUndefined();
  expect(factProblem("dates", open)).toMatch(/finished/);
});

it("writes the graduation year, marking it Expected when asked", () => {
  const seen = vi.fn();
  render(<Harness kind="graduation" onDraft={seen} />);
  pick("Graduation year", "2027");
  expect(factAnswer("graduation", seen.mock.calls.at(-1)?.[0])).toBe("2027");
  fireEvent.click(screen.getByLabelText("Expected"));
  expect(factAnswer("graduation", seen.mock.calls.at(-1)?.[0])).toBe("Expected 2027");
  expect(screen.getByLabelText("Graduation year").querySelectorAll("option").length).toBeGreaterThan(40);
});

it("sends 'skip' when skipped, and shows the hint for results", () => {
  const seen = vi.fn();
  render(<Harness kind="results" onDraft={seen} />);
  expect(screen.getByText(/A real number or outcome/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "~40 feeds polled every 10 minutes" } });
  expect(factAnswer("results", seen.mock.calls.at(-1)?.[0])).toBe("~40 feeds polled every 10 minutes");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(factAnswer("results", seen.mock.calls.at(-1)?.[0])).toBe("skip");
  expect(screen.getByText(/It won't be asked again/)).toBeTruthy();
});

it("rejects a result that is too short for the backend", () => {
  expect(factAnswer("results", { ...emptyFact, text: "fast" })).toBeUndefined();
});
