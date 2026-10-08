import { warmTemplateCache } from "@vita/core";
import { bundledTemplatesDir } from "../paths";

export async function setupCommand(): Promise<void> {
  await warmTemplateCache(bundledTemplatesDir);
  console.log("Bundled template cache warmed.");
}
