import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDraft, useJsonDraft } from "./use-draft";

afterEach(cleanup);

it("keeps the text, restores it on a new mount, and clears it", () => {
  const first = renderHook(() => useDraft("page:1"));
  act(() => first.result.current[1]("half typed"));
  expect(first.result.current[0]).toBe("half typed");
  expect(sessionStorage.getItem("vita:draft:page:1")).toBe("half typed");
  first.unmount();

  const second = renderHook(() => useDraft("page:1"));
  expect(second.result.current[0]).toBe("half typed");
  act(() => second.result.current[2]());
  expect(second.result.current[0]).toBe("");
  expect(sessionStorage.getItem("vita:draft:page:1")).toBeNull();
});

it("keeps one draft per key and falls back to the initial value", () => {
  const a = renderHook(() => useDraft("a", "auto"));
  const b = renderHook(() => useDraft("b", "auto"));
  act(() => a.result.current[1]("changed"));
  expect(b.result.current[0]).toBe("auto");
  act(() => a.result.current[1]("auto"));
  expect(sessionStorage.getItem("vita:draft:a")).toBeNull();
});

it("shows the draft of the new key when the key changes", () => {
  sessionStorage.setItem("vita:draft:job:2", "two");
  const view = renderHook(({ id }) => useDraft(`job:${id}`), { initialProps: { id: "1" } });
  expect(view.result.current[0]).toBe("");
  view.rerender({ id: "2" });
  expect(view.result.current[0]).toBe("two");
});

it("keeps working when storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const view = renderHook(() => useDraft("blocked", "start"));
  expect(view.result.current[0]).toBe("start");
  act(() => view.result.current[1]("typed"));
  expect(view.result.current[0]).toBe("typed");
  act(() => view.result.current[2]());
  expect(view.result.current[0]).toBe("start");
});

it("stores structured values and ignores a broken draft", () => {
  const first = renderHook(() => useJsonDraft<{ a?: number }>("json", {}));
  act(() => first.result.current[1]((all) => ({ ...all, a: 1 })));
  first.unmount();
  expect(renderHook(() => useJsonDraft<{ a?: number }>("json", {})).result.current[0]).toEqual({ a: 1 });
  sessionStorage.setItem("vita:draft:bad", "{nope");
  expect(renderHook(() => useJsonDraft("bad", { ok: true })).result.current[0]).toEqual({ ok: true });
});
