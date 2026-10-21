import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TemplateMeta } from "@vita/shared";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import TemplateStudioPage from "./TemplateStudioPage";

// CodeMirror needs a real layout engine; the studio only talks to the editor through its props and handle.
vi.mock("@/components/TexEditor", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    default: ({
      value,
      onChange,
      readOnly,
      errorLines,
      onSave,
      ariaLabel,
      ref,
    }: {
      value: string;
      onChange: (value: string) => void;
      readOnly?: boolean;
      errorLines?: number[];
      onSave?: () => void;
      ariaLabel: string;
      ref?: React.Ref<{ insert(text: string): void; focus(): void }>;
    }) => {
      useImperativeHandle(ref, () => ({ insert: (text: string) => onChange(`${value}${text}`), focus() {} }), [
        value,
        onChange,
      ]);
      return (
        <textarea
          aria-label={ariaLabel}
          value={value}
          readOnly={readOnly}
          data-error-lines={(errorLines ?? []).join(",")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "s" && event.ctrlKey) onSave?.();
          }}
        />
      );
    },
  };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(cleanup);

const hash = (char: string) => char.repeat(64);
const mine = {
  id: "my-copy",
  meta: TemplateMeta.parse({ id: "my-copy", name: "My copy", forkedFrom: "rover-base" }),
  source: "\\documentclass{article}\n",
  hash: hash("a"),
  editable: true,
};
const bundled = {
  id: "rover-base",
  meta: TemplateMeta.parse({ id: "rover-base", name: "Rover" }),
  source: "\\documentclass{article}\n",
  hash: hash("b"),
  editable: false,
};

beforeEach(() => {
  vi.spyOn(api.templates, "list").mockResolvedValue([
    { id: "rover-base", meta: bundled.meta, bundled: true, previewAvailable: false, previewPdfUrl: null },
  ] as never);
  vi.spyOn(api.templates, "contract").mockResolvedValue({
    delimiters: { value: "((( expression )))" },
    variables: { "header.name": "Person's name." },
    filters: { url: "Safe link." },
    snippets: { footer: "\\fancyfoot[C]{\\thepage}" },
  });
  vi.spyOn(api.templates, "preview").mockResolvedValue({ previewUrl: "/api/templates/x/adopted.pdf", log: "" });
  vi.spyOn(api.resumes, "list").mockResolvedValue([]);
  vi.spyOn(api.applications, "list").mockResolvedValue([]);
});

function mount(id: string, search = "") {
  const router = createMemoryRouter(
    [
      { path: "/settings/templates/:id", element: <TemplateStudioPage /> },
      { path: "*", element: <p>elsewhere</p> },
    ],
    { initialEntries: [`/settings/templates/${id}${search}`] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
const editorOf = (name: string) => screen.findByLabelText(`LaTeX source of ${name}`) as Promise<HTMLTextAreaElement>;
const type = (editor: HTMLElement, text: string) => fireEvent.change(editor, { target: { value: text } });

it("opens a built-in template read-only and offers a copy", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(bundled);
  const fork = vi.spyOn(api.templates, "fork").mockResolvedValue({ ...mine, sha: null });
  mount("rover-base");
  const editor = await editorOf("Rover");
  expect(editor.readOnly).toBe(true);
  expect(screen.getByText("Built-in templates can't be edited")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: /Make my own copy/ })[0] as HTMLElement);
  const dialog = await screen.findByRole("dialog");
  expect((within(dialog).getByLabelText("Name for your copy") as HTMLInputElement).value).toBe("Rover (mine)");
  fireEvent.click(within(dialog).getByRole("button", { name: "Make my copy" }));
  await waitFor(() => expect(fork).toHaveBeenCalledWith("rover-base", "Rover (mine)"));
});

it("saves, then refreshes the preview", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const save = vi
    .spyOn(api.templates, "saveSource")
    .mockResolvedValue({ ...mine, source: "new text", hash: hash("c"), sha: null });
  mount("my-copy");
  const editor = await editorOf("My copy");
  expect(screen.getByText("Copy of Rover")).toBeTruthy();
  expect(screen.getByText("Saved")).toBeTruthy();
  type(editor, "new text");
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("my-copy", { source: "new text", baseHash: hash("a") }));
  await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  await waitFor(() => expect(api.templates.preview).toHaveBeenCalledTimes(2));
});

it("marks the error lines on a 422 and keeps the text", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  vi.spyOn(api.templates, "saveSource").mockRejectedValue(
    new ApiError(422, "invalid-source", "main.tex.njk:3: Unknown tag\nmain.tex.njk:7: Bad filter"),
  );
  mount("my-copy");
  const editor = await editorOf("My copy");
  type(editor, "broken");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const problems = await screen.findByRole("list", { name: "Problems" });
  expect(within(problems).getByText("main.tex.njk:3: Unknown tag")).toBeTruthy();
  expect(editor.dataset.errorLines).toBe("3,7");
  expect(editor.value).toBe("broken");
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
});

it("offers Reload and Keep mine on a 409", async () => {
  const source = vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const save = vi
    .spyOn(api.templates, "saveSource")
    .mockRejectedValueOnce(new ApiError(409, "stale-source", "Template changed. Reload before saving."))
    .mockResolvedValue({ ...mine, source: "mine", hash: hash("d"), sha: null });
  mount("my-copy");
  type(await editorOf("My copy"), "mine");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("This template changed elsewhere")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  source.mockResolvedValue({ ...mine, hash: hash("e"), source: "theirs" });
  fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith("my-copy", { source: "mine", baseHash: hash("e") }));
  await waitFor(() => expect(screen.queryByText("This template changed elsewhere")).toBeNull());
});

it("inserts a snippet into the editor", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  mount("my-copy");
  const editor = await editorOf("My copy");
  fireEvent.click(await screen.findByRole("button", { name: "Insert footer" }));
  expect(editor.value).toBe("\\documentclass{article}\n\\fancyfoot[C]{\\thepage}");
});

const proposal = {
  diff: "@@ -1 +1,2 @@\n \\documentclass{article}\n+\\usepackage{fancyhdr}\n-old line",
  previewUrl: "/api/templates/p/adopted.pdf",
  log: "",
  source: "\\documentclass{article}\n\\usepackage{fancyhdr}\n",
  baseHash: hash("a"),
  usage: [{ role: "template-designer", model: "m", input: 10, output: 5, costUsd: 0.0123 }],
};
async function ask() {
  fireEvent.click(screen.getAllByRole("tab", { name: "Design" })[0] as HTMLElement);
  fireEvent.click(await screen.findByRole("button", { name: "Footer with page numbers" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  return screen.findByRole("region", { name: "Changes to the template" });
}

it("shows the design diff and applies it", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const design = vi.spyOn(api.templates, "design").mockResolvedValue(proposal);
  const save = vi
    .spyOn(api.templates, "saveSource")
    .mockResolvedValue({ ...mine, source: proposal.source, hash: hash("f"), sha: null });
  mount("my-copy");
  await editorOf("My copy");
  const diff = await ask();
  expect(design).toHaveBeenCalledWith("my-copy", "Footer with page numbers");
  expect(diff.querySelector('[data-diff="add"]')?.textContent).toBe("+\\usepackage{fancyhdr}");
  expect(diff.querySelector('[data-diff="remove"]')).toBeTruthy();
  expect(screen.getByText("Cost $0.01")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith("my-copy", { source: proposal.source, baseHash: proposal.baseHash }),
  );
  await waitFor(() => expect(screen.queryByRole("region", { name: "Changes to the template" })).toBeNull());
  expect(((await editorOf("My copy")) as HTMLTextAreaElement).value).toBe(proposal.source);
});

it("discards a design without saving", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  vi.spyOn(api.templates, "design").mockResolvedValue(proposal);
  const save = vi.spyOn(api.templates, "saveSource");
  mount("my-copy");
  await editorOf("My copy");
  await ask();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("region", { name: "Changes to the template" })).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it("asks to save first when the editor has unsaved changes", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const design = vi.spyOn(api.templates, "design");
  mount("my-copy");
  type(await editorOf("My copy"), "edited");
  fireEvent.click(screen.getAllByRole("tab", { name: "Design" })[0] as HTMLElement);
  expect(await screen.findByText(/Save first/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  expect(design).not.toHaveBeenCalled();
});

it("keeps a failed apply in the card", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  vi.spyOn(api.templates, "design").mockResolvedValue(proposal);
  vi.spyOn(api.templates, "saveSource").mockRejectedValue(new ApiError(422, "invalid-source", "main.tex.njk:2: Bad"));
  mount("my-copy");
  await editorOf("My copy");
  await ask();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("main.tex.njk:2: Bad")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
});

it("opens the tab named in the URL and writes the tab back to the URL when it changes", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const router = mount("my-copy", "?tab=preview");
  await editorOf("My copy");
  const tabs = screen.getByRole("tablist", { name: "Studio sections" });
  expect(within(tabs).getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(within(tabs).getByRole("tab", { name: "Design" }));
  expect(router.state.location.search).toBe("?tab=design");
  expect(within(tabs).getByRole("tab", { name: "Design" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(within(tabs).getByRole("tab", { name: "Code" }));
  expect(router.state.location.search).toBe("");
});

it("asks before in-app navigation away from unsaved changes, and stays on Stay", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const router = mount("my-copy");
  type(await editorOf("My copy"), "unsaved");
  await act(() => router.navigate("/elsewhere"));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Leave without saving?")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(router.state.location.pathname).toBe("/settings/templates/my-copy");
  await act(() => router.navigate("/elsewhere"));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));
});

it("does not ask when nothing is unsaved", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const router = mount("my-copy");
  await editorOf("My copy");
  await act(() => router.navigate("/elsewhere"));
  expect(router.state.location.pathname).toBe("/elsewhere");
});

it("restores unsaved source after a reload and says so, and Discard goes back to the saved text", async () => {
  vi.spyOn(api.templates, "source").mockResolvedValue(mine);
  const first = mount("my-copy");
  type(await editorOf("My copy"), "half typed");
  await act(() => first.navigate("/elsewhere"));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Leave" }));
  cleanup();
  mount("my-copy");
  expect(((await editorOf("My copy")) as HTMLTextAreaElement).value).toBe("half typed");
  expect(screen.getByText("Restored your unsaved changes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(((await editorOf("My copy")) as HTMLTextAreaElement).value).toBe(mine.source);
  expect(screen.queryByText("Restored your unsaved changes.")).toBeNull();
});
