import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Resume } from "@vita/shared";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { StyleDialog } from "./StyleDialog";

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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const template = {
  id: "rover-base",
  meta: {
    id: "rover-base",
    name: "Rover Base",
    kind: "resume",
    page: "a4",
    reservedKnobs: ["section_order"],
    supports: ["summary", "entries", "list", "text"],
    knobs: {
      font: { type: "enum", options: ["native", "pagella"], default: "native" },
      icons: { type: "bool", default: false },
      accent: { type: "color", default: "#1f4e79" },
      font_pt: { min: 10, max: 11.5, default: 10.5 },
      margin_in: { min: 0.5, max: 1, default: 0.75 },
    },
  },
  bundled: true,
  previewAvailable: false,
  previewPdfUrl: null,
};

const resume = {
  id: "r1",
  kind: "resume",
  parent: null,
  template: "rover-base",
  layout: { font_pt: 11 },
  header: { name: "Ada Lovelace", contact: [] },
  sections: [
    { id: "s-summary", title: "Summary", kind: "summary", items: [] },
    { id: "s-skills", title: "Skills", kind: "list", items: [] },
    { id: "s-exp", title: "Experience", kind: "entries", items: [] },
  ],
} as unknown as Resume;

async function mount(onApply = vi.fn().mockResolvedValue(true), target: Resume = resume) {
  vi.spyOn(api.templates, "list").mockResolvedValue([template] as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StyleDialog open onOpenChange={() => {}} resume={target} applying={false} onApply={onApply} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Font size");
  return onApply;
}

it("renders one control for each knob type, with readable labels", async () => {
  await mount();
  expect((screen.getByLabelText("Font size") as HTMLInputElement).type).toBe("number");
  expect(screen.getByLabelText("Margins")).toBeTruthy();
  expect((screen.getByLabelText("Accent colour picker") as HTMLInputElement).type).toBe("color");
  expect((screen.getByLabelText("Accent colour hex") as HTMLInputElement).value).toBe("#1f4e79");
  expect(screen.getByRole("switch", { name: "Icons" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Font" }).textContent).toContain("native");
  expect(screen.getByText("Between 10 and 11.5")).toBeTruthy();
});

it("sends one ops request with the changed values, typed for each knob", async () => {
  const onApply = await mount();
  fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("switch", { name: "Icons" }));
  fireEvent.change(screen.getByLabelText("Accent colour hex"), { target: { value: "#112233" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenCalledWith([
    { op: "layout.set", key: "icons", value: true },
    { op: "layout.set", key: "accent", value: "#112233" },
    { op: "layout.set", key: "font_pt", value: 10 },
  ]);
});

it("sends the chosen enum option", async () => {
  const onApply = await mount();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Font" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "pagella" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledWith([{ op: "layout.set", key: "font", value: "pagella" }]);
});

it("keeps Apply disabled for a colour that is not #RRGGBB, and for a number out of range", async () => {
  await mount();
  fireEvent.change(screen.getByLabelText("Accent colour hex"), { target: { value: "#12" } });
  expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Accent colour hex"), { target: { value: "#123456" } });
  fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "12" } });
  expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
});

it("moves a section up and sends the reordered ids", async () => {
  const onApply = await mount();
  fireEvent.click(screen.getByRole("button", { name: "Move Experience up" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledWith([
    { op: "layout.set", key: "section_order", value: ["s-summary", "s-exp", "s-skills"] },
  ]);
});

it("reset sends the template defaults that differ from the resume", async () => {
  const onApply = await mount();
  fireEvent.click(screen.getByRole("button", { name: "Reset to template defaults" }));
  expect(onApply).toHaveBeenCalledWith([{ op: "layout.set", key: "font_pt", value: 10.5 }]);
});

it("sends nothing and does not call the server when nothing changed", async () => {
  const onApply = await mount();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).not.toHaveBeenCalled();
});
