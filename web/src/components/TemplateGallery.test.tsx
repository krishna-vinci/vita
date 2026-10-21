import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { TemplateGallery } from "./TemplateGallery";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const summary = (id: string, name: string, bundled: boolean) =>
  ({
    id,
    meta: { id, name, kind: "resume", knobs: {} },
    bundled,
    previewAvailable: false,
    previewPdfUrl: null,
  }) as never;

beforeEach(() => {
  vi.spyOn(api.templates, "list").mockResolvedValue([
    summary("rover-base", "Rover", true),
    summary("mine", "Mine", false),
  ]);
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<TemplateGallery />} />
          <Route path="/settings/templates/:id" element={<p>studio</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const openMenu = async (name: string) =>
  fireEvent.pointerDown(await screen.findByRole("button", { name: `More for ${name}` }), { button: 0, ctrlKey: false });

it("copies a template from its menu, then opens the studio", async () => {
  const fork = vi
    .spyOn(api.templates, "fork")
    .mockResolvedValue({ id: "rover-mine", meta: { id: "rover-mine", name: "Rover (mine)" }, sha: null } as never);
  mount();
  expect(await screen.findByText("Yours")).toBeTruthy();
  await openMenu("Rover");
  expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Make my own copy/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Name for your copy"), { target: { value: "Rover plus" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Make my copy" }));
  await waitFor(() => expect(fork).toHaveBeenCalledWith("rover-base", "Rover plus"));
  expect(await screen.findByText("studio")).toBeTruthy();
});

it("lists the resumes that use a template when deleting is refused", async () => {
  vi.spyOn(api.templates, "discard").mockRejectedValue(
    new ApiError(409, "template-in-use", "Template is used by resumes", undefined, {
      resumes: ["resumes/ai-backend", "applications/acme-sre"],
    }),
  );
  mount();
  await openMenu("Mine");
  fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  expect(await within(dialog).findByText("ai-backend")).toBeTruthy();
  expect(within(dialog).getByText("acme-sre")).toBeTruthy();
  expect((within(dialog).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
});
