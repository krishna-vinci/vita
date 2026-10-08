import { Command } from "commander";

const program = new Command().name("vita").description("A self-hosted resume studio.");
program.parse();
if (process.argv.length === 2) program.outputHelp();
