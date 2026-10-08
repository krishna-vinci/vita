import { Resume, TemplateMeta } from "@vita/shared";
import type { OpContext } from "./types.js";

export function sampleResume(): Resume {
  return Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "example",
    layout: { margin: 0.75 },
    header: { name: "Alex Example", contact: [] },
    sections: [
      {
        id: "experience",
        title: "Experience",
        kind: "entries",
        items: [
          {
            id: "first",
            title: "Example Cooperative",
            bullets: [
              { id: "one", text: "Prepared notes.", claims: ["project.notes"] },
              { id: "two", text: "Shared updates.", claims: [] },
            ],
          },
          { id: "second", title: "Example Association", bullets: [] },
        ],
      },
      { id: "projects", title: "Projects", kind: "entries", items: [] },
    ],
  });
}

export function context(by: OpContext["by"] = "user"): OpContext {
  return {
    by,
    now: () => "2026-10-09T12:00:00Z",
    template: TemplateMeta.parse({
      id: "example",
      name: "Example",
      knobs: { font: { min: 10, max: 12, default: 11 }, margin: { min: 0.5, max: 1, default: 0.75 } },
    }),
    index: {
      claims: new Map([
        [
          "project.notes",
          {
            id: "project.notes",
            text: "Prepared clear notes.",
            source: "projects",
            itemSlug: "project",
            itemName: "Example Project",
            evidence: [],
            metrics: [],
            limits: [],
          },
        ],
      ]),
      variants: new Map([
        [
          "project.short",
          { id: "project.short", text: "Prepared concise notes.", label: "Short", itemSlug: "project" },
        ],
      ]),
      items: new Map(),
    },
  };
}
