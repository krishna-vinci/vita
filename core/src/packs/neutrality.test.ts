import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "fixtures" || /(?:^|[.-])tests?(?:[.-]|$)/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

it("keeps profession vocabulary out of engine, shared schemas and CLI implementation", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const vocabulary = /kubernetes|docker|react|nurse|patient|devops/gi;
  const violations: string[] = [];
  for (const pkg of ["core", "shared", "cli"]) {
    for (const file of await sourceFiles(join(root, pkg, "src"))) {
      const source = await readFile(file, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        for (const match of line.matchAll(vocabulary)) violations.push(`${file}:${index + 1}: ${match[0]}`);
      }
    }
  }
  expect(violations).toEqual([]);
});
