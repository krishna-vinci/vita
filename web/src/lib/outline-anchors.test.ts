import { expect, it } from "vitest";
import { restoreAnchors, stripAnchors } from "./outline-anchors";

const md = "# Me\n- Built it. <!-- c:a-1 -->\n- Built it. <!-- c:a-2 ev:ev-1 -->\n- Kept <!-- c:b-1 -->\n";
it("hides anchors and puts them back unchanged when nothing was edited", () => {
  const { display, table } = stripAnchors(md);
  expect(display).not.toContain("<!--");
  expect(restoreAnchors(display, table)).toBe(md);
});
it("keeps edited and new lines without anchors and never drops text", () => {
  const { display, table } = stripAnchors(md);
  const out = restoreAnchors(`${display.replace("- Kept", "- Kept and extended")}- New line\n`, table);
  expect(out).toContain("- Kept and extended\n");
  expect(out).not.toContain("b-1");
  expect(out).toContain("- New line");
  expect(out).toContain("- Built it. <!-- c:a-1 -->");
});
