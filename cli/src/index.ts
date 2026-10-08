import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { checkCommand } from "./commands/check";
import { importCommand } from "./commands/import";
import { initCommand } from "./commands/init";
import { renderCommand } from "./commands/render";
import { setupCommand } from "./commands/setup";

export { checkCommand, importCommand, initCommand, renderCommand, setupCommand };

export function createProgram(): Command {
  const program = new Command().name("vita").description("A self-hosted resume studio.");
  program.command("init <dir>").option("--name <name>").action(initCommand);
  program
    .command("import <dir>")
    .requiredOption("--projects <legacy.md>")
    .option("--outline <outline.md>")
    .action(async (dir, opts) => {
      await importCommand(dir, opts);
    });
  program
    .command("render <dir>")
    .option("--resume <id>", "Resume to render", "master")
    .option("--out <dir>")
    .action(async (dir, opts) => {
      if (!(await renderCommand(dir, opts)).ok) process.exitCode = 1;
    });
  program
    .command("check <dir>")
    .option("--resume <id>", "Resume to check", "master")
    .action(async (dir, opts) => {
      if (!(await checkCommand(dir, opts)).ok) process.exitCode = 1;
    });
  program.command("setup").description("Warm the package cache for bundled templates.").action(setupCommand);
  return program;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const program = createProgram();
  if (process.argv.length === 2) program.outputHelp();
  else
    await program.parseAsync().catch((error: unknown) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    });
}
