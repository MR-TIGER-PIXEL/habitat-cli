import { Command } from "commander";
import { printBlueprintDetails, printBlueprintList } from "./formatters";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import type { StoredBlueprint } from "../kepler";

export function createBlueprintCommand(): Command {
  const blueprintCommand = new Command("blueprint");

  blueprintCommand.description("Inspect the official Kepler blueprint catalog without changing local state.");

  blueprintCommand
    .command("list")
    .description("List official Kepler blueprint catalog entries.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printBlueprintList(await api.listOfficialBlueprints());
    });

  blueprintCommand
    .command("show")
    .description("Show one official Kepler blueprint catalog entry.")
    .argument("<blueprint-id>", "Official blueprint id")
    .action(async (blueprintId: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printBlueprintDetails((await api.getOfficialBlueprint(blueprintId)).blueprint as StoredBlueprint);
    });

  return blueprintCommand;
}
