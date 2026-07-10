import { Command } from "commander";
import { printSolarStatus } from "./formatters";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createSolarCommand(): Command {
  const solarCommand = new Command("solar");

  solarCommand.description("Inspect current Kepler world sunlight without changing local habitat state.");

  solarCommand
    .command("status")
    .description("Show the current Kepler solar irradiance and condition.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printSolarStatus(await api.getSolarIrradiance());
    });

  return solarCommand;
}
