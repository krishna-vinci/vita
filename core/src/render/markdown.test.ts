import { readFile } from "node:fs/promises";
import { Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

it("renders a fixed Markdown format with only visible content", async () => {
  const resume = Resume.parse(
    JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
  );
  expect(renderMarkdown(resume)).toMatchInlineSnapshot(`
    "# Alex Example

    Operations coordinator

    Email: alex@example.test

    ## Summary

    Thoughtful coordination & clear communication.

    ## Experience

    ### Example Cooperative — Coordinator · 2024–2026

    Example City

    - Recorded & % $ # _ { } ~ ^ \\ symbols accurately.
    - Prepared “clear” notes — including ‘office’ updates – for everyone.

    ## Skills

    ### Coordination

    ### Writing & editing

    ## Notes

    Available for local assignments.
    "
  `);
});
