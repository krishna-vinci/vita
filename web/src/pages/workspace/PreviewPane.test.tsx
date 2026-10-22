import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { qualityApi } from "@/api/client";
import { PreviewPane, previewDebounceMs } from "./PreviewPane";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(version: string) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = (v: string) => (
    <QueryClientProvider client={client}>
      <PreviewPane scope="application" id="acme" version={v} className="flex flex-col" />
    </QueryClientProvider>
  );
  const result = render(view(version));
  return { rerender: (v: string) => result.rerender(view(v)) };
}
const frames = () => [...document.querySelectorAll("iframe")];
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

it("renders at once on open and shows the PDF when it loads", async () => {
  const preview = vi.spyOn(qualityApi, "preview").mockResolvedValue({ url: "/api/preview/a.pdf" });
  mount("h1");
  await flush();
  expect(preview).toHaveBeenCalledWith("application", "acme");
  const [first] = frames();
  expect(first?.getAttribute("src")).toContain("/api/preview/a.pdf");
  expect(first?.getAttribute("aria-hidden")).toBe("true");
  fireEvent.load(first as Element);
  await flush();
  expect(frames()).toHaveLength(1);
  expect(frames()[0]?.getAttribute("aria-hidden")).toBeNull();
});

it("waits 800 ms after a change, and keeps the old PDF until the new one loads", async () => {
  const preview = vi
    .spyOn(qualityApi, "preview")
    .mockResolvedValueOnce({ url: "/api/preview/a.pdf" })
    .mockResolvedValueOnce({ url: "/api/preview/b.pdf" });
  const view = mount("h1");
  await flush();
  fireEvent.load(frames()[0] as Element);
  await flush();
  view.rerender("h2");
  view.rerender("h3");
  await act(async () => void (await vi.advanceTimersByTimeAsync(previewDebounceMs - 100)));
  expect(preview).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Updating preview…")).toBeTruthy();
  await act(async () => void (await vi.advanceTimersByTimeAsync(150)));
  expect(preview).toHaveBeenCalledTimes(2);
  // The old PDF is still the visible one while the new one loads behind it.
  expect(frames().map((frame) => frame.getAttribute("src"))).toEqual([
    expect.stringContaining("a.pdf"),
    expect.stringContaining("b.pdf"),
  ]);
  expect(frames()[0]?.getAttribute("aria-hidden")).toBeNull();
  fireEvent.load(frames()[1] as Element);
  await flush();
  expect(frames()).toHaveLength(1);
  expect(frames()[0]?.getAttribute("src")).toContain("b.pdf");
  expect(screen.queryByText("Updating preview…")).toBeNull();
});

it("shows the compile message and retries", async () => {
  const preview = vi
    .spyOn(qualityApi, "preview")
    .mockRejectedValueOnce(new Error("! Undefined control sequence"))
    .mockResolvedValueOnce({ url: "/api/preview/a.pdf" });
  mount("h1");
  await flush();
  expect(screen.getByText("Couldn't render the preview")).toBeTruthy();
  expect(screen.getByText("! Undefined control sequence")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
  await flush();
  expect(preview).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Couldn't render the preview")).toBeNull();
});
