import { cleanup, render, screen } from "@testing-library/react";
import type { Resume } from "@vita/shared";
import { afterEach, expect, it, vi } from "vitest";
import { ResumeSheet } from "./ResumeSheet";
import type { SheetContext } from "./types";

afterEach(cleanup);

const bullet = (id: string, text: string) => ({ id, text, claims: [], origin: "ai", locked: false });
const resume = {
  id: "r1",
  kind: "resume",
  parent: null,
  template: "rover-base",
  layout: {},
  header: {
    name: "Ada Lovelace",
    location: "Pune, India",
    contact: [{ label: "Email", value: "ada@example.com" }],
  },
  sections: [
    {
      id: "s-skills",
      title: "Skills",
      kind: "list",
      items: [
        {
          id: "i-lang",
          title: "Languages",
          bullets: [bullet("b-go", "Go"), bullet("b-ts", "TypeScript")],
        },
      ],
    },
  ],
} as unknown as Resume;

const ctx = {
  actions: {
    edit: vi.fn(),
    hide: vi.fn(),
    hideSection: vi.fn(),
    hideItem: vi.fn(),
    move: vi.fn(),
    vouch: vi.fn(),
    ask: vi.fn(),
  },
  details: false,
  busy: false,
  changed: new Set<string>(),
  claims: new Map(),
  checks: new Map(),
} as unknown as SheetContext;

it("shows the location before the contacts in the header line", () => {
  render(<ResumeSheet resume={resume} flags={new Map()} ctx={ctx} />);
  const line = screen.getByText("Pune, India").closest("p");
  expect(line?.textContent).toBe("Pune, India · ada@example.com");
});

it("renders a titled list item as a bold title and its skills on one line", () => {
  render(<ResumeSheet resume={resume} flags={new Map()} ctx={ctx} />);
  const title = screen.getByText("Languages:");
  expect(title.tagName).toBe("STRONG");
  expect(title.parentElement?.textContent).toBe("Languages:GoTypeScript");
  expect(screen.getByRole("button", { name: "Edit: Go" })).toBeTruthy();
});
