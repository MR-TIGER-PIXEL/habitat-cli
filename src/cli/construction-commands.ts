import { Command } from "commander";
import { cancelConstructionJob, listActiveConstructionJobs, resolveConfig } from "../kepler";
import { printConstructionStatus } from "./formatters";

export function createConstructionCommand(): Command {
  const constructionCommand = new Command("construction");

  constructionCommand.description("Inspect active local construction jobs.");

  constructionCommand
    .command("status")
    .description("Show active local construction jobs attached to fabricators.")
    .action(() => {
      const config = resolveConfig(process.cwd());
      printConstructionStatus(listActiveConstructionJobs(config));
    });

  constructionCommand
    .command("cancel")
    .description("Cancel the active local construction job on one fabricator.")
    .argument("<fabricator-alias-or-id>", "Fabricator alias or module id")
    .action((moduleReference: string) => {
      const config = resolveConfig(process.cwd());
      const result = cancelConstructionJob(config, moduleReference);
      console.log(`Canceled construction job on "${result.fabricatorAlias}".`);
      console.log(`fabricatorId: ${result.fabricatorId}`);
    });

  return constructionCommand;
}
