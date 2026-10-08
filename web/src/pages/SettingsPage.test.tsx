import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SettingsView } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import SettingsPage from "./SettingsPage";

const settings: SettingsView = {
  models: { default: "faux/echo", roles: { checker: "other/checker" } },
  template: "rover-base",
  providers: [
    { id: "faux", hasCredentials: true },
    { id: "other", hasCredentials: false },
  ],
  warnings: [],
};
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.spyOn(api.settings, "get").mockResolvedValue(settings);
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
  vi.unstubAllGlobals();
  for (const client of clients) client.clear();
  clients.length = 0;
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}
it("shows credential status, reveals roles and saves a typed configuration", async () => {
  const save = vi.spyOn(api.settings, "save").mockResolvedValue({ ...settings, sha: null });
  mount();
  await screen.findByLabelText("Default model");
  expect(screen.getByText("Credentials available")).toBeTruthy();
  expect(screen.getByText("No credentials found")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Advanced: models for each step" }));
  expect(screen.getAllByRole("combobox")).toHaveLength(4);
  fireEvent.change(screen.getByLabelText("Checking the facts model ID"), { target: { value: "different/check" } });
  fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "writer/model" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      { models: { default: "writer/model", roles: { checker: "different/check" } }, template: "rover-base" },
      expect.anything(),
    ),
  );
});
it("keeps the form editable and reports server save failures", async () => {
  vi.spyOn(api.settings, "save").mockRejectedValue(new ApiError(400, "not-found", "Template not installed"));
  mount();
  await screen.findByLabelText("Default model");
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByText("Template not installed")).toBeTruthy();
  expect((screen.getByLabelText("Default model") as HTMLInputElement).value).toBe("faux/echo");
});
it("rejects malformed model IDs before sending them", async () => {
  const save = vi.spyOn(api.settings, "save");
  mount();
  await screen.findByLabelText("Default model");
  fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "missing-provider" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByText(/Use provider\/model for each model/)).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
});
