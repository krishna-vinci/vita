import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PathEscapeError";
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function canonicalPath(root: string, target: string): string {
  const realRoot = realpathSync(root);
  let ancestor = target;
  while (true) {
    try {
      // lstat sees dangling symlinks too: they must not be treated as missing paths.
      lstatSync(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new PathEscapeError(`No existing ancestor for: ${target}`);
      ancestor = parent;
    }
  }
  let realAncestor: string;
  try {
    realAncestor = realpathSync(ancestor);
  } catch (cause) {
    throw new PathEscapeError(`Cannot resolve path: ${target}`, { cause });
  }
  if (!isInside(realRoot, realAncestor)) throw new PathEscapeError(`Path escapes workspace: ${target}`);
  return path.join(realAncestor, path.relative(ancestor, target));
}

export function resolveInWorkspace(root: string, rel: string): string {
  if (rel.includes("\0") || path.isAbsolute(rel) || rel.split(path.sep).includes("..")) {
    throw new PathEscapeError(`Invalid workspace-relative path: ${rel}`);
  }
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, rel);
  if (!isInside(rootAbs, target)) throw new PathEscapeError(`Path escapes workspace: ${rel}`);
  return canonicalPath(rootAbs, target);
}

export function relFromRoot(root: string, abs: string): string {
  if (!path.isAbsolute(abs) || abs.includes("\0")) throw new PathEscapeError(`Invalid absolute path: ${abs}`);
  const realRoot = realpathSync(root);
  const rootAbs = path.resolve(root);
  const target = path.resolve(abs);
  if (!isInside(rootAbs, target) && !isInside(realRoot, target)) {
    throw new PathEscapeError(`Path escapes workspace: ${abs}`);
  }
  return path.relative(realRoot, canonicalPath(rootAbs, target));
}
