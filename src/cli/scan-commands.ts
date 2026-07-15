import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import { printScanResult } from "./formatters";

export function createScanCommand(): Command {
  const scanCommand = new Command("scan");

  scanCommand
    .description("Scan nearby world tiles through the local Habitat API.")
    .requiredOption("--strength <0-100>", "Sensor strength")
    .option("--radius <0-5>", "Centered square scan radius in tiles", "0")
    .option("--json", "Print the complete scan response as JSON")
    .action(async (options: {
      strength: string;
      radius: string;
      json?: boolean;
    }) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.scanWorld({
        sensorStrength: options.strength,
        radiusTiles: options.radius,
      });
      printScanResult(result, { json: options.json === true });
    });

  return scanCommand;
}
