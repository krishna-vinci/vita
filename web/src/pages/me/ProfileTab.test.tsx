import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProfileView } from "@vita/shared";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import ProfileTab from "./ProfileTab";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Radix Select scrolls the chosen option into view, which jsdom does not implement.
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(cleanup);

const loaded: ProfileView = {
  profile: {
    name: "Krishna",
    headline: "Platform engineer",
    location: "Pune",
    contact: [{ label: "GitHub", value: "github.com/krishna" }],
    default_relationship: "lead",
  },
  hash: "h1",
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfileTab />
    </QueryClientProvider>,
  );
}

it("renders the loaded values", async () => {
  vi.spyOn(api.profile, "get").mockResolvedValue(loaded);
  mount();
  expect((await screen.findByLabelText("Name")).getAttribute("value")).toBe("Krishna");
  expect((screen.getByLabelText("Headline") as HTMLInputElement).value).toBe("Platform engineer");
  expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("Pune");
  expect((screen.getByLabelText("Contact 1 label") as HTMLInputElement).value).toBe("GitHub");
  expect((screen.getByLabelText("Contact 1 value") as HTMLInputElement).value).toBe("github.com/krishna");
  expect(screen.getByRole("combobox", { name: "My projects are" }).textContent).toContain("Led by me");
});

it("adds a contact and a location, drops the blank row, and saves", async () => {
  vi.spyOn(api.profile, "get").mockResolvedValue(loaded);
  const save = vi.spyOn(api.profile, "save").mockResolvedValue({ ...loaded, hash: "h2", sha: "abc" });
  mount();
  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: " Remote, India " } });
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  fireEvent.change(screen.getByLabelText("Contact 2 label"), { target: { value: " Website " } });
  fireEvent.change(screen.getByLabelText("Contact 2 value"), { target: { value: "krishna.dev" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]).toEqual({
    profile: {
      name: "Krishna",
      headline: "Platform engineer",
      location: "Remote, India",
      contact: [
        { label: "GitHub", value: "github.com/krishna" },
        { label: "Website", value: "krishna.dev" },
      ],
      default_relationship: "lead",
    },
    baseHash: "h1",
  });
});

it("sends the sole role for 'Mine: I built them alone' and omits it for 'Not set'", async () => {
  vi.spyOn(api.profile, "get").mockResolvedValue(loaded);
  const save = vi.spyOn(api.profile, "save").mockResolvedValue({ ...loaded, hash: "h2", sha: null });
  mount();
  await screen.findByLabelText("Name");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "My projects are" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Mine: I built them alone" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]?.profile.default_relationship).toBe("sole");
});

it("omits the role when 'Not set' is chosen", async () => {
  vi.spyOn(api.profile, "get").mockResolvedValue(loaded);
  const save = vi.spyOn(api.profile, "save").mockResolvedValue({ ...loaded, hash: "h2", sha: null });
  mount();
  await screen.findByLabelText("Name");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "My projects are" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Not set: ask me per project" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]?.[0]?.profile.default_relationship).toBeUndefined();
});

it("keeps Save disabled while the name is empty", async () => {
  vi.spyOn(api.profile, "get").mockResolvedValue(loaded);
  mount();
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "  " } });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
});

it("refetches the profile after a 409", async () => {
  const get = vi.spyOn(api.profile, "get").mockResolvedValue(loaded);
  vi.spyOn(api.profile, "save").mockRejectedValue(
    new ApiError(409, "stale-hash", "Your profile changed elsewhere. Reload it and try again."),
  );
  mount();
  fireEvent.change(await screen.findByLabelText("Location"), { target: { value: "Berlin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
