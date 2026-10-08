import { Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { checkRender, normalizeForMatch } from "./textcheck";

function resume(texts: string[]): Resume {
  return Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Example" },
    sections: [
      {
        id: "entries",
        title: "Entries",
        kind: "entries",
        items: [
          {
            id: "entry",
            title: "Entry",
            bullets: texts.map((text, index) => ({ id: `b${index}`, text })),
          },
        ],
      },
    ],
  });
}

it("normalizes ligatures, line-end hyphenation, quotes, dashes and whitespace", () => {
  expect(normalizeForMatch("  “Ofﬁce” — ﬂow\n hyphen-\n ation ‘clear’  ")).toBe(
    "\"office\" - flow hyphenation 'clear'",
  );
  expect(normalizeForMatch("``office'' --- flow -- next `clear'")).toBe("\"office\" - flow - next 'clear'");
});

it("detects missing and out-of-order bullet ids and page overflow", () => {
  const data = resume(["First bullet", "Second bullet"]);
  expect(checkRender(data, { text: "First bullet", pages: 1 })).toEqual({
    pages: 1,
    missingBullets: ["b1"],
    outOfOrder: [],
    ok: false,
  });
  expect(checkRender(data, { text: "Second bullet\nFirst bullet", pages: 1 }, 1)).toEqual({
    pages: 1,
    maxPages: 1,
    missingBullets: [],
    outOfOrder: ["b1"],
    ok: false,
  });
  expect(checkRender(data, { text: "First bullet\nSecond bullet", pages: 2 }, 1).ok).toBe(false);
});

it("matches repeated bullets to successive occurrences and ignores hidden content", () => {
  const data = resume(["Repeated bullet", "Repeated bullet", "Hidden bullet"]);
  const hidden = data.sections[0]?.items[0]?.bullets[2];
  if (hidden) hidden.hidden = true;
  expect(checkRender(data, { text: "Repeated bullet\nRepeated bullet", pages: 1 }, 1).ok).toBe(true);
  expect(checkRender(data, { text: "Repeated bullet", pages: 1 }).outOfOrder).toEqual(["b1"]);
});
