import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const bundledTemplatesDir = join(repoRoot, "templates");
