import { describe, expect, it } from "vitest";
import { Resume, visibleBullets } from "./resume";

const header = {
  id: "master",
  kind: "master",
  parent: null,
  template: "rover-base",
  header: { name: "Alex Example" },
};

describe("Resume", () => {
  it("parses a minimal resume and fills defaults", () => {
    const resume = Resume.parse({
      ...header,
      sections: [
        { id: "summary", title: "Summary", kind: "summary", text: "A short introduction." },
        {
          id: "work",
          title: "Work",
          kind: "entries",
          items: [{ id: "item-a", title: "Example", bullets: [{ id: "bullet-a", text: "Improved a process." }] }],
        },
      ],
    });

    expect(resume.layout).toEqual({});
    expect(resume.header.contact).toEqual([]);
    expect(resume.sections[0]?.items).toEqual([]);
    expect(resume.sections[1]?.items[0]?.bullets[0]).toEqual({
      id: "bullet-a",
      text: "Improved a process.",
      claims: [],
      origin: "ai",
      locked: false,
    });
  });

  it.each([
    {
      label: "bullet ids across items",
      duplicate: "bullet-a",
      sections: [
        {
          id: "work",
          title: "Work",
          kind: "entries",
          items: [
            { id: "item-a", title: "First", bullets: [{ id: "bullet-a", text: "First fact." }] },
            { id: "item-b", title: "Second", bullets: [{ id: "bullet-a", text: "Second fact." }] },
          ],
        },
      ],
    },
    {
      label: "item ids across sections",
      duplicate: "item-a",
      sections: [
        { id: "first", title: "First", kind: "entries", items: [{ id: "item-a", title: "First" }] },
        { id: "second", title: "Second", kind: "entries", items: [{ id: "item-a", title: "Second", hidden: true }] },
      ],
    },
    {
      label: "section ids",
      duplicate: "summary",
      sections: [
        { id: "summary", title: "First", kind: "summary" },
        { id: "summary", title: "Second", kind: "text", hidden: true },
      ],
    },
    {
      label: "ids shared by different node kinds",
      duplicate: "shared-id",
      sections: [{ id: "shared-id", title: "Work", kind: "entries", items: [{ id: "shared-id", title: "Example" }] }],
    },
  ])("rejects duplicate $label and names the id", ({ sections, duplicate }) => {
    const result = Resume.safeParse({ ...header, sections });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes(duplicate))).toBe(true);
    }
  });

  it("returns visible bullets in document order while skipping hidden ancestors and bullets", () => {
    const resume = Resume.parse({
      ...header,
      sections: [
        {
          id: "hidden-section",
          title: "Hidden",
          kind: "entries",
          hidden: true,
          items: [
            { id: "hidden-section-item", title: "Hidden", bullets: [{ id: "hidden-by-section", text: "Hidden." }] },
          ],
        },
        {
          id: "first-section",
          title: "First",
          kind: "entries",
          items: [
            {
              id: "hidden-item",
              title: "Hidden",
              hidden: true,
              bullets: [{ id: "hidden-by-item", text: "Hidden." }],
            },
            {
              id: "first-item",
              title: "First",
              bullets: [
                { id: "visible-first", text: "First." },
                { id: "hidden-bullet", text: "Hidden.", hidden: true },
                { id: "visible-second", text: "Second.", hidden: false },
              ],
            },
            { id: "second-item", title: "Second", bullets: [{ id: "visible-third", text: "Third." }] },
          ],
        },
        {
          id: "last-section",
          title: "Last",
          kind: "list",
          items: [{ id: "last-item", title: "Last", bullets: [{ id: "visible-last", text: "Last." }] }],
        },
      ],
    });

    expect(visibleBullets(resume).map((bullet) => bullet.id)).toEqual([
      "visible-first",
      "visible-second",
      "visible-third",
      "visible-last",
    ]);
  });
});
