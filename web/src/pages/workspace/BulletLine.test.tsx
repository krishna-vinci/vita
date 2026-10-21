import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Bullet } from "@vita/shared";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BulletLine } from "./BulletLine";
import type { SheetContext } from "./types";

afterEach(cleanup);

const bullet = (overrides: Partial<Bullet> = {}): Bullet =>
  ({ id: "b1", text: "Cut costs 40%", claims: [], origin: "ai", locked: false, ...overrides }) as Bullet;

function ctx(overrides: Partial<SheetContext> = {}, actions: Partial<SheetContext["actions"]> = {}) {
  return {
    actions: {
      edit: vi.fn(),
      hide: vi.fn(),
      lock: vi.fn(),
      undo: vi.fn(),
      hideSection: vi.fn(),
      hideItem: vi.fn(),
      move: vi.fn(),
      vouch: vi.fn(),
      ask: vi.fn(),
      ...actions,
    },
    details: false,
    busy: false,
    changed: new Set<string>(),
    claims: new Map(),
    checks: new Map(),
    estimates: new Map(),
    ...overrides,
  } as unknown as SheetContext;
}

function line(b: Bullet, context: SheetContext) {
  return render(
    <TooltipProvider>
      <ul>
        <BulletLine bullet={b} ctx={context} position={{ itemId: "i1", itemSlug: "role", index: 0, count: 1 }} />
      </ul>
    </TooltipProvider>,
  );
}

async function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Line options" }), { button: 0, ctrlKey: false });
  await screen.findByRole("menu");
}

it("shows a lock icon on a locked line, and Unlock calls the lock action with false", async () => {
  const context = ctx();
  line(bullet({ locked: true }), context);
  expect(screen.getByRole("img", { name: /Locked: regenerating keeps this line/ })).toBeTruthy();
  await openMenu();
  expect(context.actions.lock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Unlock" }));
  expect(context.actions.lock).toHaveBeenCalledWith("b1", false);
});

it("offers Lock on an unlocked line, with no lock icon", async () => {
  const context = ctx();
  line(bullet(), context);
  expect(screen.queryByRole("img", { name: /Locked:/ })).toBeNull();
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Lock" }));
  expect(context.actions.lock).toHaveBeenCalledWith("b1", true);
});

it("notes a line updated from the outline, and Undo calls the undo action", () => {
  const context = ctx();
  line(bullet({ updatedFromSource: { at: "2026-10-01T10:00:00+00:00", previousText: "Old wording" } }), context);
  expect(screen.getByText("Updated from your outline (you edited this line before)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(context.actions.undo).toHaveBeenCalledTimes(1);
});

it("says what the person said as the basis, in details and as a badge outside them", () => {
  const checks = new Map([
    ["b1", { bulletId: "b1", basis: "statement" as const, verdict: "supported" as const, reason: "x" }],
  ]);
  const estimates = new Map([["b1", "Your estimate: 40%"]]);
  const { unmount } = line(bullet(), ctx({ checks, estimates }));
  expect(screen.getByText("you said")).toBeTruthy();
  unmount();

  line(bullet(), ctx({ checks, estimates, details: true }));
  expect(screen.getByText("Checked: supported, from what you said")).toBeTruthy();
  expect(screen.getByText("Your estimate: 40%")).toBeTruthy();
  expect(screen.queryByText("you said")).toBeNull();
});
