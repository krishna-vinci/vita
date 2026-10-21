import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TemplateMeta } from "@vita/shared";
import { expect, it } from "vitest";
import { loadTemplate, resolveLayout } from "./templates";

it("resolves defaults, clamps numeric layout values and ignores unknown or invalid values", () => {
  const meta = TemplateMeta.parse({
    id: "example",
    name: "Example",
    knobs: {
      font: { min: 10, max: 12, default: 11 },
      margin: { min: 0.5, max: 1, default: 0.75 },
    },
  });
  expect(resolveLayout(meta, {})).toEqual({ font: 11, margin: 0.75 });
  expect(resolveLayout(meta, { font: 30, margin: "0.1", other: 5 })).toEqual({ font: 12, margin: 0.5 });
  expect(resolveLayout(meta, { font: "invalid", margin: Number.NaN })).toEqual({ font: 11, margin: 0.75 });
});

it("loads the first matching template and validates its metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vita-template-test-"));
  try {
    const roots = [join(dir, "workspace"), join(dir, "bundled")];
    for (const [index, root] of roots.entries()) {
      await mkdir(join(root, "example"), { recursive: true });
      await writeFile(join(root, "example/template.yaml"), `id: example\nname: Version ${index}\n`);
    }
    expect((await loadTemplate(roots, "example")).meta.name).toBe("Version 0");
    expect((await loadTemplate([join(dir, "missing"), roots[1] ?? ""], "example")).meta.name).toBe("Version 1");
    await writeFile(join(roots[0] ?? "", "example/template.yaml"), "id: other\nname: Wrong\n");
    await expect(loadTemplate(roots, "example")).rejects.toThrow("mismatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects traversal ids and metadata symlinks escaping a search root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vita-template-test-"));
  try {
    await mkdir(join(dir, "root/example"), { recursive: true });
    await writeFile(join(dir, "outside.yaml"), "id: example\nname: Outside\n");
    await symlink(join(dir, "outside.yaml"), join(dir, "root/example/template.yaml"));
    await expect(loadTemplate([join(dir, "root")], "example")).rejects.toThrow("escapes");
    await expect(loadTemplate([dir], "../outside")).rejects.toThrow();
    await expect(loadTemplate([dir], "missing")).rejects.toThrow("not found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("resolves enum, hex colour and bool knobs, rejecting unsafe or mistyped values", () => {
  const meta = TemplateMeta.parse({
    id: "typed",
    name: "Typed",
    knobs: {
      font: { type: "enum", options: ["native", "fira-sans"], default: "native" },
      accent: { type: "color", default: "#141E61" },
      icons: { type: "bool", default: false },
    },
  });
  expect(resolveLayout(meta, { font: "fira-sans", accent: "#AABBcc", icons: true })).toEqual({
    font: "fira-sans",
    accent: "#AABBcc",
    icons: true,
  });
  expect(resolveLayout(meta, {})).toEqual({ font: "native", accent: "#141E61", icons: false });
  const invalid: Record<string, string | number | boolean>[] = [
    { font: "\\input{evil}" },
    { accent: "#FFF" },
    { accent: "red" },
    { icons: "true" },
    { icons: 1 },
  ];
  for (const layout of invalid) expect(() => resolveLayout(meta, layout)).toThrow(/Invalid layout/);
});
