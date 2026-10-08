import { Resume, TemplateMeta } from "@vita/shared";

export function fixture(lengths = [3, 2]): Resume {
  return Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "fit-fixture",
    header: { name: "Alex Example" },
    sections: [
      {
        id: "work",
        title: "Work",
        kind: "entries",
        items: lengths.map((length, item) => ({
          id: `item-${item}`,
          title: "Example Cooperative",
          bullets: Array.from({ length }, (_, bullet) => ({
            id: `bullet-${item}-${bullet}`,
            text: `Prepared clear notes for assignment ${item}-${bullet}.`,
            claims: ["example-notes"],
          })),
        })),
      },
    ],
  });
}

export const meta = TemplateMeta.parse({
  id: "fit-fixture",
  name: "Fit fixture",
  knobs: {
    line_spread: { min: 0.8, max: 1.2, default: 1 },
    section_gap_pt: { min: 2, max: 10, default: 6 },
    margin_in: { min: 0.5, max: 1, default: 0.75 },
    font_pt: { min: 10, max: 12, default: 11 },
    untouched: { min: 1, max: 3, default: 2 },
  },
});
