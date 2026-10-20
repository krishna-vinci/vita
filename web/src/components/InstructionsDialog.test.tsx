import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { InstructionsDialog } from "./InstructionsDialog";

afterEach(cleanup);
function mount(scope: "application" | "resume" = "application") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InstructionsDialog open onOpenChange={() => {}} scope={scope} id="acme" saved="Lead with backend." />
    </QueryClientProvider>,
  );
}

it("shows the saved text, warns about locked bullets and saves", async () => {
  const save = vi.spyOn(api.applications, "saveInstructions").mockResolvedValue({ sha: null });
  mount();
  const box = screen.getByLabelText("Instructions") as HTMLTextAreaElement;
  expect(box.value).toBe("Lead with backend.");
  expect(screen.getByText(/Locked bullets stay/)).toBeTruthy();
  fireEvent.change(box, { target: { value: "Keep it to one page." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("acme", { instructions: "Keep it to one page." }));
});

it("saves and regenerates a base through the base route", async () => {
  const regenerate = vi.spyOn(api.resumes, "regenerate").mockResolvedValue({ job: { id: "j1" } } as never);
  mount("resume");
  fireEvent.click(screen.getByRole("button", { name: /Save & regenerate/ }));
  await waitFor(() => expect(regenerate).toHaveBeenCalledWith("acme", { instructions: "Lead with backend." }));
});
