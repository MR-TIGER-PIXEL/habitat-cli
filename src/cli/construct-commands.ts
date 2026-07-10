import { Command } from "commander";
import { printConstructionPlan, printConstructionStarted } from "./formatters";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createConstructCommand(): Command {
  const constructCommand = new Command("construct");

  constructCommand
    .description("Validate whether a locally stored blueprint can begin construction.")
    .argument("<blueprint-id>", "Local blueprint id")
    .option("--dry-run", "Report construction readiness without changing local state")
    .action(async (blueprintId: string, options: { dryRun?: boolean }) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });

      if (options.dryRun) {
        printConstructionPlan(await api.planConstruction(blueprintId));
        return;
      }

      printConstructionStarted(await api.startConstruction(blueprintId));
    });

  return constructCommand;
}
