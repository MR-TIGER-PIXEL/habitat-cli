import { Command } from "commander";
import { printResourceList } from "./formatters";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createResourceCommand(): Command {
  const resourceCommand = new Command("resource");

  resourceCommand.description("Inspect the official Kepler resource catalog without changing local state.");

  resourceCommand
    .command("list")
    .description("List official Kepler resource catalog entries.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printResourceList(await api.listOfficialResources());
    });

  return resourceCommand;
}
