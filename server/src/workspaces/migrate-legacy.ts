import { stat } from "node:fs/promises";
import path from "node:path";

/** Keep an existing single-user workspace exactly where its owner put it. */
export async function legacyWorkspace(root?: string): Promise<string | null> {
  if (!root) return null;
  const resolved = path.resolve(root);
  try {
    return (await stat(path.join(resolved, "outline.md"))).isFile() ? resolved : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
