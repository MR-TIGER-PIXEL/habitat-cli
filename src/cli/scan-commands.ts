import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import { printScanResult } from "./formatters";
import { parseIntegerInRange, parseStrictInteger } from "./parsers";

export function createScanCommand(): Command {
  const scanCommand = new Command("scan");

  scanCommand
    .description("Scan nearby world tiles through the local Habitat API.")
    .requiredOption("--x <integer>", "Scanner origin x coordinate", (value: string) =>
      parseStrictInteger(value, "x"))
    .requiredOption("--y <integer>", "Scanner origin y coordinate", (value: string) =>
      parseStrictInteger(value, "y"))
    .requiredOption("--strength <0-100>", "Sensor strength", (value: string) =>
      parseIntegerInRange(value, "strength", 0, 100))
    .option("--radius <0-5>", "Centered square scan radius in tiles", (value: string) =>
      parseIntegerInRange(value, "radius", 0, 5), 0)
    .option("--json", "Print the complete scan response as JSON")
    .action(async (options: {
      x: number;
      y: number;
      strength: number;
      radius: number;
      json?: boolean;
    }) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.scanWorld({
        x: options.x,
        y: options.y,
        sensorStrength: options.strength,
        radiusTiles: options.radius,
      });
      printScanResult(result, { json: options.json === true });
    });

  return scanCommand;
}
