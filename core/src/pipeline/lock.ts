import { FileLocks, resolveInWorkspace } from "../workspace/index.js";

const locks = new FileLocks();

export async function withGenerationLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const release = await locks.acquire(resolveInWorkspace(root, "."), "pipeline");
  try {
    return await action();
  } finally {
    release();
  }
}
