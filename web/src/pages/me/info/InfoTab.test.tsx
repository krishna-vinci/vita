import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { InfoView } from "@vita/shared";
import { createMemoryRouter, type RouteObject, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { routes } from "@/router";
import InfoTab from "./InfoTab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [] } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const at = <T,>(items: T[], index: number): T => items[index] as T;

const view = (patch: Partial<InfoView> = {}): InfoView => ({
  hash: { outline: "ho1", projects: "hp1", profile: "hf1" },
  profile: { name: "Morgan Vale", headline: "Developer", contact: [], location: "Pune" },
  summary: { text: "Builds things." },
  roles: [
    {
      id: "software-developer-harbour-tools",
      title: "Software Developer",
      organisation: "Harbour Tools",
      location: "Remote",
      period: "2023–2026",
      highlights: [
        { id: "c-one", text: "Built the importer" },
        { id: "c-two", text: "Led the migration" },
      ],
    },
  ],
  projects: [
    {
      id: "feed-reader",
      name: "Feed Reader",
      links: ["https://github.com/morgan/feed-reader"],
      stack: ["Python"],
      highlights: [{ id: "c-p1", text: "Filtered feeds with a model" }],
    },
    {
      id: "archive",
      name: "Community Archive",
      period: "2025–2026",
      purpose: "A volunteer archive for local groups",
      links: [],
      stack: [],
      highlights: [],
    },
  ],
  education: [{ id: "bsc-computing", degree: "BSc in Computing", institution: "Northbank College" }],
  certifications: [{ id: "aws", name: "AWS Cloud Practitioner", status: "2025" }],
  other: [{ section: "Skills", title: "Languages" }],
  ...patch,
});

function mount(initial = "/me/info") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter(
          [
            { path: "/me/info", element: <InfoTab /> },
            { path: "/me/outline", element: <p>outline page</p> },
            { path: "/start", element: <p>start page</p> },
          ],
          { initialEntries: [initial] },
        )}
      />
    </QueryClientProvider>,
  );
}
const open = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Edit ${name}` }));

it("shows roles, projects, education, certifications and the other sections", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  mount();
  expect(await screen.findByText("Software Developer")).toBeTruthy();
  expect(screen.getByText("Harbour Tools · Remote · 2023–2026")).toBeTruthy();
  expect(screen.getByText("Feed Reader")).toBeTruthy();
  expect(screen.getByText("2025–2026 · A volunteer archive for local groups")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open github.com/morgan/feed-reader" })).toBeTruthy();
  expect(screen.getByText("BSc in Computing")).toBeTruthy();
  expect(screen.getByText("AWS Cloud Practitioner")).toBeTruthy();
  expect(screen.getByText("Other sections from your outline")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Edit in Outline (text)" })).toBeTruthy();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Morgan Vale");
});

it("sends people with an empty workspace to the start page", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view({ hash: { outline: "", projects: "", profile: "" } }));
  mount();
  expect(await screen.findByText("Let's start with you")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Get started" }).getAttribute("href")).toBe("/start");
});

it("saves a project's purpose and dates as a patch with the projects hash, then shows the server values", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  const next = view({
    hash: { outline: "ho1", projects: "hp2", profile: "hf1" },
    projects: [
      { ...at(view().projects, 0), purpose: "A news reader for busy readers", period: "Mar 2024 – Present" },
      at(view().projects, 1),
    ],
  });
  const update = vi.spyOn(api.info.projects, "update").mockResolvedValue(next);
  mount();
  await screen.findByText("Feed Reader");
  open("Feed Reader");
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: " A news reader for busy readers " } });
  fireEvent.change(at(screen.getAllByLabelText("From (month and year)"), 0), { target: { value: "Mar 2024" } });
  fireEvent.click(screen.getByLabelText("Ongoing"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith("feed-reader", {
    purpose: "A news reader for busy readers",
    period: "Mar 2024 – Present",
    baseHash: "hp1",
  });
  expect(await screen.findByText("Mar 2024 – Present · A news reader for busy readers")).toBeTruthy();
  // The card is clean again, so Save is gone.
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});

it("keeps a highlight's id when its text changes, sends none for a new one, and drops a removed one", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  const update = vi.spyOn(api.info.roles, "update").mockResolvedValue(view());
  mount();
  await screen.findByText("Software Developer");
  open("Software Developer");
  fireEvent.change(screen.getByLabelText("What you did 1"), { target: { value: "Built the importer in two weeks" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove bullet 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a bullet" }));
  fireEvent.change(screen.getByLabelText("What you did 2"), { target: { value: "Cut build time by half" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledWith("software-developer-harbour-tools", {
    highlights: [{ id: "c-one", text: "Built the importer in two weeks" }, { text: "Cut build time by half" }],
    baseHash: "ho1",
  });
});

it("lists missing dates, purpose and year, and opens the card on click", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  mount();
  const hint = (await screen.findByText("Make your resumes stronger")).closest("[data-slot=card]") as HTMLElement;
  expect(within(hint).getByRole("button", { name: "Feed Reader: add dates" })).toBeTruthy();
  expect(within(hint).getByRole("button", { name: "Feed Reader: add a one-line purpose" })).toBeTruthy();
  expect(within(hint).getByRole("button", { name: "BSc in Computing: add the year" })).toBeTruthy();
  expect(within(hint).queryByText(/Community Archive/)).toBeNull();
  fireEvent.click(within(hint).getByRole("button", { name: "Feed Reader: add a one-line purpose" }));
  expect(await screen.findByLabelText("Purpose")).toBeTruthy();
  await waitFor(() => expect(document.activeElement?.id).toBe("project-feed-reader-purpose"));
  fireEvent.click(within(hint).getByRole("button", { name: "Hide this for now" }));
  expect(screen.queryByText("Make your resumes stronger")).toBeNull();
});

it("hides the hints when nothing is missing", async () => {
  const full = view();
  vi.spyOn(api.info, "get").mockResolvedValue({
    ...full,
    projects: [{ ...at(full.projects, 0), period: "2024", purpose: "A reader" }, at(full.projects, 1)],
    education: [{ ...at(full.education, 0), year: "2023" }],
  });
  mount();
  await screen.findByText("Feed Reader");
  expect(screen.queryByText("Make your resumes stronger")).toBeNull();
});

it("asks before deleting, then deletes with the outline hash", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  const remove = vi.spyOn(api.info.education, "remove").mockResolvedValue(view({ education: [] }));
  mount();
  await screen.findByText("BSc in Computing");
  open("BSc in Computing");
  fireEvent.click(screen.getByRole("button", { name: "Delete BSc in Computing" }));
  expect(await screen.findByText("Delete BSc in Computing permanently?")).toBeTruthy();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("bsc-computing", { baseHash: "ho1" }));
});

it("reloads with a note on a 409 and keeps the edit", async () => {
  const get = vi.spyOn(api.info, "get").mockResolvedValue(view());
  vi.spyOn(api.info.certifications, "update").mockRejectedValue(
    new ApiError(409, "stale-hash", "File changed elsewhere"),
  );
  mount();
  await screen.findByText("AWS Cloud Practitioner");
  open("AWS Cloud Practitioner");
  fireEvent.change(screen.getByLabelText("Year or status"), { target: { value: "2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Vita reloaded it");
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect((screen.getByLabelText("Year or status") as HTMLInputElement).value).toBe("2026");
});

it("offers 'Update resumes' after saving when resumes went stale", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  vi.spyOn(api.sync, "status").mockResolvedValue({ stale: [{ id: "master", reason: "Your info changed" }] } as never);
  vi.spyOn(api.info, "saveSummary").mockResolvedValue(view());
  mount();
  await screen.findByLabelText("Summary");
  fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Builds useful things." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.info.saveSummary).toHaveBeenCalledWith({ text: "Builds useful things.", baseHash: "ho1" }),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Saved",
      expect.objectContaining({ action: expect.objectContaining({ label: "Update resumes" }) }),
    ),
  );
});

it("redirects /me and the old /me/profile to /me/info", async () => {
  const me = (routes as RouteObject[])
    .flatMap((route) => route.children ?? [])
    .flatMap((route) => route.children ?? [])
    .find((route) => route.path === "/me");
  const children = (me?.children ?? []).filter((route) => !("lazy" in route));
  for (const from of ["/me", "/me/profile"]) {
    const router = createMemoryRouter(
      [
        { path: "/me", children },
        { path: "/me/info", element: <p>info page</p> },
      ],
      { initialEntries: [from] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("info page")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/me/info");
    cleanup();
  }
});

it("saves 'About you' with the profile hash, dropping blank contact rows", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  const save = vi.spyOn(api.info, "saveProfile").mockResolvedValue(view());
  mount();
  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: " Remote, India " } });
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  fireEvent.change(screen.getByLabelText("Contact 1 label"), { target: { value: "Website" } });
  fireEvent.change(screen.getByLabelText("Contact 1 value"), { target: { value: "morgan.dev" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save).toHaveBeenCalledWith({
    profile: {
      name: "Morgan Vale",
      headline: "Developer",
      location: "Remote, India",
      contact: [{ label: "Website", value: "morgan.dev" }],
    },
    baseHash: "hf1",
  });
});

it("keeps unsaved card text across a reload and clears it once saved", async () => {
  vi.spyOn(api.info, "get").mockResolvedValue(view());
  vi.spyOn(api.info, "saveSummary").mockResolvedValue(view());
  mount();
  fireEvent.change(await screen.findByLabelText("Summary"), { target: { value: "Half typed" } });
  expect(sessionStorage.getItem("vita:draft:info:summary")).not.toBeNull();
  cleanup();
  mount();
  expect(((await screen.findByLabelText("Summary")) as HTMLTextAreaElement).value).toBe("Half typed");
  expect(screen.getByText("Restored your unsaved changes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(sessionStorage.getItem("vita:draft:info:summary")).toBeNull());
});
