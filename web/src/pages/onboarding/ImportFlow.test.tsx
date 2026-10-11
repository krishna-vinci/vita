import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { ImportFlow } from "./ImportFlow";

afterEach(cleanup);
it("lets you pick a file, then shows what was found before anything is saved", async () => {
  const proposal = {
    outline: {
      file: "outline",
      before: "",
      after: "- Built things",
      summary: "Outline from your resume",
      baseHash: "a".repeat(64),
    },
    projects: { file: "projects", before: "", after: "## Thing", summary: "One project", baseHash: "a".repeat(64) },
    profile: { before: "", after: { name: "Morgan Vale", contact: [] }, baseHash: "a".repeat(64) },
    questions: ["How many people used it?"],
  };
  vi.spyOn(api.onboarding, "importResume").mockResolvedValue(proposal as never);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ImportFlow onInterview={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText("Your old resume") as HTMLInputElement;
  const file = new File(["x"], "cv.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await screen.findByText("Here's what I found. Nothing is saved yet.");
  expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();
  expect(screen.getByText("How many people used it?")).toBeTruthy();
});
