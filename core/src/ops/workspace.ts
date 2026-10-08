import { Resume } from "@vita/shared";
import {
  type Author,
  commitPaths,
  FileLocks,
  readText,
  relFromRoot,
  resolveInWorkspace,
  writeTextAtomic,
} from "../workspace/index.js";
import { applyOps } from "./apply.js";
import type { OpContext, ResumeOp } from "./types.js";

const edits = new FileLocks();

export async function applyResumeOps(
  root: string,
  resumePath: string,
  ops: ResumeOp[],
  ctx: OpContext,
  author: Author,
): Promise<{ resume: Resume; sha: string | null; changedBullets: string[] }> {
  const target = resolveInWorkspace(root, resumePath);
  const rel = relFromRoot(root, target);
  const release = await edits.acquire(target, "applyResumeOps");
  try {
    const resume = Resume.parse(JSON.parse(await readText(root, rel)));
    const result = applyOps(resume, ops, ctx);
    const validated = Resume.parse(result.resume);
    await writeTextAtomic(root, rel, `${JSON.stringify(validated, null, 2)}\n`);
    const sha = await commitPaths(root, [rel], "Apply resume edits", author);
    return { ...result, resume: validated, sha };
  } finally {
    release();
  }
}
