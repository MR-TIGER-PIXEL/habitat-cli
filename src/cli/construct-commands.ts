import { Command } from "commander";
import { planConstruction, resolveConfig, startConstruction } from "../kepler";
import { printConstructionPlan, printConstructionStarted } from "./formatters";

export function createConstructCommand(): Command {
  const constructCommand = new Command("construct");

  constructCommand
    .description("Validate whether a locally stored blueprint can begin construction.")
    .argument("<blueprint-id>", "Local blueprint id")
    .option("--dry-run", "Report construction readiness without changing local state")
    .action(async (blueprintId: string, options: { dryRun?: boolean }) => {
      const config = resolveConfig(process.cwd());

      if (options.dryRun) {
        printConstructionPlan(planConstruction(config, blueprintId));
        return;
      }

      printConstructionStarted(await startConstruction(config, blueprintId));
    });

  return constructCommand;
}
