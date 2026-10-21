import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  render(<Questions gaps={gaps} pending={false} onSubmit={onSubmit} draftKey="questions:test" onSkipAll={() => {}} />);
  const groups = screen.getAllByRole("group");
  fireEvent.click(groups[0]?.querySelector("button") as HTMLElement);
  fireEvent.change(screen.getByLabelText(/Where and what/), { target: { value: "Ran it at work" } });
  fireEvent.click(screen.getAllByRole("button", { name: "No" })[1] as HTMLElement);
  fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[2] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onSubmit).toHaveBeenCalledWith({ "req-a": "Yes: Ran it at work", "req-b": "no" });
});

it("keeps choices and typed details across a remount, and clears them once sent", async () => {
  const gaps = parseGaps(["req-a: Have you used Kubernetes?", "req-b: Have you used Go?"]);
  const onSubmit = vi.fn();
  const view = render(
    <Questions gaps={gaps} pending={false} onSubmit={onSubmit} draftKey="questions:j1" onSkipAll={() => {}} />,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Yes, I have" })[0] as HTMLElement);
  fireEvent.change(screen.getByLabelText(/Where and what/), { target: { value: "Ran it at work" } });
  fireEvent.click(screen.getAllByRole("button", { name: "No" })[1] as HTMLElement);
  view.unmount();

  render(<Questions gaps={gaps} pending={false} onSubmit={onSubmit} draftKey="questions:j1" onSkipAll={() => {}} />);
  expect((screen.getByLabelText(/Where and what/) as HTMLTextAreaElement).value).toBe("Ran it at work");
  expect(screen.getAllByRole("button", { name: "No" })[1]?.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ "req-a": "Yes: Ran it at work", "req-b": "no" }));
  await waitFor(() => expect(sessionStorage.getItem("vita:draft:questions:j1")).toBeNull());
});

it("keeps the draft when sending fails", async () => {
  const gaps = parseGaps(["req-a: Have you used Kubernetes?"]);
  render(
    <Questions gaps={gaps} pending={false} onSubmit={async () => false} draftKey="questions:j2" onSkipAll={() => {}} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy());
  expect(sessionStorage.getItem("vita:draft:questions:j2")).toContain("no");
});
