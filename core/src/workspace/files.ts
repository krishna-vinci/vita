import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileLocks } from "./lock.js";
import { relFromRoot, resolveInWorkspace } from "./paths.js";

const writes = new FileLocks();

export async function readText(root: string, rel: string): Promise<string> {
  return readFile(resolveInWorkspace(root, rel), "utf8");
}

export async function writeTextAtomic(root: string, rel: string, content: string): Promise<void> {
  return writeFileAtomic(root, rel, content);
}

/** Binary-safe atomic write (e.g. PDFs). Strings are written as UTF-8. */
export async function writeFileAtomic(root: string, rel: string, content: string | Uint8Array): Promise<void> {
  const target = resolveInWorkspace(root, rel);
  const release = await writes.acquire(target, "writeFileAtomic");
  let temporary: string | undefined;
  try {
    const canonicalRel = relFromRoot(root, target);
    resolveInWorkspace(root, canonicalRel);
    await mkdir(path.dirname(target), { recursive: true });
    resolveInWorkspace(root, canonicalRel);
    temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomUUID()}`);
    const temporaryRel = relFromRoot(root, temporary);
    await writeFile(
      resolveInWorkspace(root, temporaryRel),
      content,
      typeof content === "string" ? { encoding: "utf8", flag: "wx" } : { flag: "wx" },
    );
    await rename(resolveInWorkspace(root, temporaryRel), resolveInWorkspace(root, canonicalRel));
  } finally {
    try {
      if (temporary !== undefined) {
        await unlink(resolveInWorkspace(root, relFromRoot(root, temporary))).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    } finally {
      release();
    }
  }
}

export async function fileHash(root: string, rel: string): Promise<string | null> {
  const target = resolveInWorkspace(root, rel);
  try {
    return createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
