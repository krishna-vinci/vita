import { fileURLToPath } from "node:url";
import { Contact, Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { contactView, linkedResume } from "./links";
import { renderMarkdown } from "./markdown";
import { createTexEnv } from "./nunjucks";
import { loadTemplate } from "./templates";
import { renderTex } from "./tex";

it.each([
  ["https://github.com/person/", undefined, "person", "https://github.com/person/"],
  ["https://www.linkedin.com/in/person/", undefined, "person", "https://www.linkedin.com/in/person/"],
  ["https://www.example.test/path/", undefined, "example.test/path", "https://www.example.test/path/"],
  ["me@example.test", undefined, "me@example.test", "mailto:me@example.test"],
  ["+1 (555) 123-4567", undefined, "+1 (555) 123-4567", "tel:+15551234567"],
  ["Portfolio", "https://example.test", "Portfolio", "https://example.test"],
  ["github.com/person", undefined, "person", "https://github.com/person"],
  ["www.linkedin.com/in/person/", undefined, "person", "https://www.linkedin.com/in/person/"],
  ["www.example.test", undefined, "example.test", "https://www.example.test"],
  ["Berlin, Germany", undefined, "Berlin, Germany", undefined],
  ["Remote", undefined, "Remote", undefined],
  ["javascript:alert(1)", undefined, "javascript:alert(1)", undefined],
  ["Portfolio", "javascript:alert(1)", "Portfolio", undefined],
  ["me@example.test", "file:///private", "me@example.test", undefined],
])("contact %s has short text and a safe target", (value, url, display, href) => {
  expect(contactView(Contact.parse({ label: "Contact", value, url }))).toMatchObject({ display, href });
});
const projects = `## Newsy
\`\`\`yaml
links:
  - https://github.com/example/newsy/blob/main/README.md
  - https://github.com/example/newsy/tree/main
  - https://github.com/example/newsy/commit/abc
  - https://github.com/example/newsy
  - https://newsy.example.test/landing
  - https://another.example.test
\`\`\`
### Claims
- Published a readable digest. <!-- c:newsy-digest -->
## Records
\`\`\`yaml
links: [https://records.example.test]
\`\`\`
### Claims
- Kept records. <!-- c:records-kept -->
`;
function sample() {
  return Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Alex", contact: [{ label: "GitHub", value: "https://github.com/person" }] },
    sections: [
      {
        id: "projects",
        title: "Projects",
        kind: "entries",
        items: [
          {
            id: "newsy",
            title: "Newsy",
            bullets: [{ id: "digest", text: "Published a readable digest.", claims: ["newsy-digest"] }],
          },
        ],
      },
    ],
  });
}
it("derives one Website then one repository from metadata, matching source, id or most claims", () => {
  const resume = sample();
  const expected = [
    { label: "Website", url: "https://newsy.example.test/landing" },
    { label: "GitHub", url: "https://github.com/example/newsy" },
  ];
  const entry = at(at(resume.sections, 0).items, 0);
  for (const input of [
    entry,
    { ...entry, id: "other", source: "projects.md#newsy" },
    {
      ...entry,
      id: "other",
      bullets: [...entry.bullets, { ...at(entry.bullets, 0), id: "records", claims: ["records-kept"] }],
    },
  ]) {
    at(resume.sections, 0).items[0] = input;
    expect(linkedResume(resume, { projects }).sections[0]?.items[0]?.links).toEqual(expected);
  }
  expect(entry.links).toBeUndefined();
  entry.links = [{ label: "Docs & notes", url: "https://example.test/notes" }];
  at(resume.sections, 0).items[0] = entry;
  expect(linkedResume(resume, { projects }).sections[0]?.items[0]?.links).toEqual(entry.links);
  entry.links = [];
  expect(linkedResume(resume, { projects }).sections[0]?.items[0]?.links).toEqual([]);
});
it("reads outline entry metadata and rejects non-web and git permalinks", () => {
  const resume = sample();
  const outline = `## Work\n### Newsy\n\`\`\`yaml\nlinks: [javascript:alert, 'https://gitlab.com/team/repo/tree/main', https://gitlab.com/team/repo]\n\`\`\`\n- Published a readable digest. <!-- c:newsy-digest -->`;
  expect(linkedResume(resume, { outline }).sections[0]?.items[0]?.links).toEqual([
    { label: "GitLab", url: "https://gitlab.com/team/repo" },
  ]);
});
it("uses the same contacts and evidence links in TeX and Markdown with URL escaping", async () => {
  const resume = sample();
  at(at(resume.sections, 0).items, 0).links = [{ label: "Web & notes", url: "https://example.test/a%20b?x=1#notes" }];
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const tex = renderTex(resume, tpl, { projects });
  expect(tex).toContain(String.raw`\href{https://github.com/person}{person}`);
  expect(tex).toContain(String.raw`\href{https://example.test/a\%20b?x=1\#notes}{Web \& notes}`);
  expect(tex).not.toContain("GitHub:");
  const markdown = renderMarkdown(resume, { projects });
  expect(markdown).toContain("[person](<https://github.com/person>)");
  expect(markdown).toContain("[Web & notes](<https://example.test/a%20b?x=1#notes>)");
  const env = createTexEnv(tpl.dir);
  expect(env.renderString("((( target | url )))", { target: String.raw`https://example.test/{a}\b%20#c` })).toBe(
    String.raw`https://example.test/\{a\}%5Cb\%20\#c`,
  );
  expect(env.renderString("((( target | url )))", { target: "javascript:alert(1)" })).toBe("");
});

function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

it("drops a subtitle or location that only repeats a shown link, and keeps other text", () => {
  const resume = sample();
  const entry = at(at(resume.sections, 0).items, 0);
  entry.subtitle = "github.com/example/newsy";
  entry.location = "Remote";
  const linked = at(at(linkedResume(resume, { projects }).sections, 0).items, 0);
  expect(linked.subtitle).toBeUndefined();
  expect(linked.location).toBe("Remote");
  entry.subtitle = "github.com/example/other";
  expect(linkedResume(resume, { projects }).sections[0]?.items[0]?.subtitle).toBe("github.com/example/other");
});
