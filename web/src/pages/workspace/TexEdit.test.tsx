import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import WorkspacePage from "./WorkspacePage";

// CodeMirror needs a real layout engine; the dialog only talks to the editor through its props.
vi.mock("@/components/TexEditor", () => ({
  default: ({
    value,
    onChange,
    errorLines,
    onSave,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    errorLines?: number[];
    onSave?: () => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      data-error-lines={(errorLines ?? []).join(",")}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "s" && event.ctrlKey) onSave?.();
      }}
    />
  ),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.matchMedia ??= (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as never;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.spyOn(api.jobs, "list").mockResolvedValue([]);
  vi.spyOn(api.resumes, "list").mockResolvedValue([]);
  vi.spyOn(api.outline, "get").mockResolvedValue({ markdown: "", hash: "", sha: null } as never);
  vi.spyOn(api.projects, "get").mockResolvedValue({ markdown: "", hash: "", sha: null } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const hash = (char: string) => char.repeat(64);
const resource = (kind: "master" | "base" | "job", extra: object = {}) =>
  ({
    resume: {
      id: kind,
      kind,
      parent: kind === "job" ? "ai" : null,
      template: "rover-base",
      layout: {},
      header: { name: "Ada Lovelace", contact: [] },
      sections: [],
    },
    pdfUrl: null,
    hash: "h",
    review: null,
    ...(kind === "job"
      ? {
          status: "draft",
          jobText: "x",
          notes: "",
          analysis: { title: "SRE", company: "Acme", summary: "", requirements: [], baseScores: [] },
          gaps: [],
          answers: {},
        }
      : {}),
    ...extra,
  }) as never;
const view = (extra: object = {}) => ({
  generated: "\\begin{document}\nhello\n\\end{document}\n",
  patched: "\\begin{document}\nhello\n\\end{document}\n",
  patch: null,
  hash: hash("a"),
  ...extra,
});
const saved = (extra: object = {}) => ({ ...view(), sha: null, pdfUrl: "/api/files/x.pdf", ...extra }) as never;

function mount(scope: "resume" | "application", path = "/me/resumes/ai") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/me/resumes/:id" element={<WorkspacePage scope={scope} />} />
          <Route path="/jobs/:id" element={<WorkspacePage scope={scope} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function openMenu() {
  fireEvent.pointerDown(await screen.findByRole("button", { name: /Download/ }), { button: 0, ctrlKey: false });
}
async function openEditor() {
  await openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: /Edit LaTeX/ }));
  return (await screen.findByLabelText("LaTeX of this resume")) as HTMLTextAreaElement;
}
const type = (editor: HTMLElement, text: string) => fireEvent.change(editor, { target: { value: text } });

it("offers Edit LaTeX on a base resume and on a job, but not on the master", async () => {
  vi.spyOn(api.tex, "get").mockResolvedValue(view());
  vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base"));
  mount("resume");
  expect((await openEditor()).value).toContain("hello");
  cleanup();
  vi.spyOn(api.applications, "get").mockResolvedValue(resource("job"));
  mount("application", "/jobs/acme");
  expect(await openEditor()).toBeTruthy();
  cleanup();
  vi.mocked(api.resumes.get).mockResolvedValue(resource("master"));
  mount("resume", "/me/resumes/master");
  await openMenu();
  await screen.findByRole("menuitem", { name: /Change template/ });
  expect(screen.queryByRole("menuitem", { name: /Edit LaTeX/ })).toBeNull();
});

it("saves {tex, baseHash} and refreshes the resume", async () => {
  vi.spyOn(api.tex, "get").mockResolvedValue(view());
  const get = vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base"));
  const save = vi
    .spyOn(api.tex, "save")
    .mockResolvedValue(saved({ patched: "tweaked", patch: "@@ -1 +1 @@\n-a\n+b", hash: hash("b") }));
  mount("resume");
  const editor = await openEditor();
  expect(screen.getByText("Your edits are kept and reapplied after every regenerate.")).toBeTruthy();
  type(editor, "tweaked");
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  const before = get.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("resume", "ai", { tex: "tweaked", baseHash: hash("a") }));
  await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before));
  await waitFor(() =>
    expect(screen.getByText("Your edits are kept and reapplied after every regenerate.")).toBeTruthy(),
  );
});

it("marks lines on a 422 and explains unexpected items", async () => {
  vi.spyOn(api.tex, "get").mockResolvedValue(view());
  vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base"));
  vi.spyOn(api.tex, "save").mockRejectedValue(
    new ApiError(422, "tex-check-failed", "Patched PDF failed the text or page check", undefined, {
      ok: false,
      pages: 1,
      missingBullets: [],
      outOfOrder: [],
      unexpectedItems: ["Invented a new bullet"],
    }),
  );
  mount("resume");
  const editor = await openEditor();
  type(editor, "broken");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const problems = await screen.findByRole("list", { name: "Problems" });
  expect(within(problems).getByText(/Invented a new bullet/)).toBeTruthy();
  expect(
    screen.getByText("Add bullets in the resume editor so they are checked; LaTeX edits are for layout."),
  ).toBeTruthy();
  expect(editor.value).toBe("broken");
});

it("marks the lines a compile error names", async () => {
  vi.spyOn(api.tex, "get").mockResolvedValue(view());
  vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base"));
  vi.spyOn(api.tex, "save").mockRejectedValue(
    new ApiError(422, "compile-failed", "Tectonic exited with code 1\nerror: main.tex:2: Undefined control sequence"),
  );
  mount("resume");
  const editor = await openEditor();
  type(editor, "broken");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("list", { name: "Problems" });
  expect(editor.dataset.errorLines).toBe("2");
});

it("offers Reload and Keep mine on a 409", async () => {
  const get = vi.spyOn(api.tex, "get").mockResolvedValue(view());
  vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base"));
  const save = vi
    .spyOn(api.tex, "save")
    .mockRejectedValueOnce(new ApiError(409, "stale-hash", "LaTeX changed. Reload before saving."))
    .mockResolvedValue(saved({ patched: "mine", hash: hash("d") }));
  mount("resume");
  type(await openEditor(), "mine");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("This LaTeX changed elsewhere")).toBeTruthy();
  get.mockResolvedValue(view({ hash: hash("e") }));
  fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith("resume", "ai", { tex: "mine", baseHash: hash("e") }));
});

it("resets to the generated LaTeX after confirmation", async () => {
  vi.spyOn(api.tex, "get").mockResolvedValue(view({ patched: "custom", patch: "@@ -1 +1 @@\n-a\n+b" }));
  vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base"));
  const reset = vi.spyOn(api.tex, "reset").mockResolvedValue(saved({ hash: hash("c") }));
  mount("resume");
  const editor = await openEditor();
  expect(editor.value).toBe("custom");
  fireEvent.click(screen.getByRole("button", { name: "Reset to generated" }));
  expect(reset).not.toHaveBeenCalled();
  fireEvent.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Reset" }));
  await waitFor(() => expect(reset).toHaveBeenCalledWith("resume", "ai"));
  await waitFor(() => expect(editor.value).toContain("hello"));
});

it("shows the conflict banner and lists the hunks under Review", async () => {
  vi.spyOn(api.resumes, "get").mockResolvedValue(resource("base", { patchConflict: true }));
  vi.spyOn(api.tex, "get").mockResolvedValue(
    view({
      conflict: {
        failedHunks: [
          { oldStart: 4, oldLines: 1, newStart: 4, newLines: 2, lines: [" keep", "+\\vspace{2pt}"] },
          { oldStart: 9, oldLines: 1, newStart: 10, newLines: 1, lines: ["-old", "+new"] },
        ],
      },
    }),
  );
  mount("resume");
  expect(await screen.findByText("Some of your LaTeX edits didn't fit the regenerated resume.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  const first = await screen.findByRole("region", { name: "Edit that did not apply, part 1" });
  expect(first.textContent).toContain("+\\vspace{2pt}");
  expect(screen.getByRole("region", { name: "Edit that did not apply, part 2" }).textContent).toContain("+new");
});
