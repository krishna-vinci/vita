import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parseGaps, Questions } from "./Questions";

afterEach(cleanup);
it("sends yes with a note, sends no, and leaves skipped questions out", () => {
  const onSubmit = vi.fn();
  const gaps = parseGaps([
    "req-a: Have you used Kubernetes?",
    "req-b: Have you used Go?",
    "req-c: Do you have experience with X?",
  ]);
  render(<Questions gaps={gaps} pending={false} onSubmit={onSubmit} onSkipAll={() => {}} />);
  const groups = screen.getAllByRole("group");
  fireEvent.click(groups[0]?.querySelector("button") as HTMLElement);
  fireEvent.change(screen.getByLabelText(/Where and what/), { target: { value: "Ran it at work" } });
  fireEvent.click(screen.getAllByRole("button", { name: "No" })[1] as HTMLElement);
  fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[2] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onSubmit).toHaveBeenCalledWith({ "req-a": "Yes: Ran it at work", "req-b": "no" });
});
