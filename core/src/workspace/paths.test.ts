import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathEscapeError, relFromRoot, resolveInWorkspace } from "./paths.js";

describe("workspace confinement", () => {
  let temporary: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), "vita-paths-"));
    root = path.join(temporary, "workspace");
    outside = path.join(temporary, "outside");
    await mkdir(root);
    await mkdir(outside);
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it.each(["../x", "nested/../x", "/etc/passwd", "file\0.md"])("rejects invalid path %j", (rel) => {
    expect(() => resolveInWorkspace(root, rel)).toThrow(PathEscapeError);
  });

  it("allows existing and not-yet-existing nested paths and returns their relative paths", async () => {
    await writeFile(path.join(root, "outline.md"), "outline\n");
    for (const rel of ["outline.md", "new/deep/file.md"]) {
      expect(resolveInWorkspace(root, rel)).toBe(path.join(root, rel));
      expect(relFromRoot(root, path.join(root, rel))).toBe(rel);
    }
    expect(relFromRoot(root, root)).toBe("");
    expect(() => relFromRoot(root, path.join(outside, "file.md"))).toThrow(PathEscapeError);
    expect(() => relFromRoot(root, "relative.md")).toThrow(PathEscapeError);
  });

  it("rejects escaping directory/file symlinks, missing descendants and dangling symlinks", async () => {
    await writeFile(path.join(outside, "secret.md"), "outside\n");
    await symlink(outside, path.join(root, "escape"));
    await symlink(path.join(outside, "secret.md"), path.join(root, "file-link"));
    await symlink(path.join(outside, "missing"), path.join(root, "dangling"));
    for (const rel of ["escape/secret.md", "escape/new/deep.md", "file-link", "dangling", "dangling/new.md"]) {
      expect(() => resolveInWorkspace(root, rel)).toThrow(PathEscapeError);
      expect(() => relFromRoot(root, path.join(root, rel))).toThrow(PathEscapeError);
    }
  });

  it("confines paths through an aliased root and allows symlinks that stay inside it", async () => {
    await mkdir(path.join(root, "resumes"));
    await symlink(path.join(root, "resumes"), path.join(root, "alias"));
    const rootAlias = path.join(temporary, "workspace-alias");
    await symlink(root, rootAlias);
    expect(resolveInWorkspace(rootAlias, "alias/new/file.md")).toBe(path.join(root, "resumes/new/file.md"));
    expect(relFromRoot(rootAlias, path.join(rootAlias, "alias/new/file.md"))).toBe("resumes/new/file.md");
    expect(relFromRoot(rootAlias, path.join(root, "resumes/new/file.md"))).toBe("resumes/new/file.md");
  });
});
