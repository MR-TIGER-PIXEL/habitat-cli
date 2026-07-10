import { Command } from "commander";
import { printConstructionStatus } from "./formatters";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createConstructionCommand(): Command {
  const constructionCommand = new Command("construction");

  constructionCommand.description("Inspect active local construction jobs.");

  constructionCommand
    .command("status")
    .description("Show active local construction jobs attached to fabricators.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printConstructionStatus(await api.constructionStatus());
    });

  constructionCommand
    .command("cancel")
    .description("Cancel the active local construction job on one fabricator.")
    .argument("<fabricator-alias-or-id>", "Fabricator alias or module id")
    .action(async (moduleReference: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.cancelConstruction(moduleReference);
      console.log(`Canceled construction job on "${result.fabricatorAlias}".`);
      console.log(`fabricatorId: ${result.fabricatorId}`);
    });

  return constructionCommand;
}
