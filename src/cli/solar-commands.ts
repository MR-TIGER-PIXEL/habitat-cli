import { Command } from "commander";
import { getSolarIrradiance, resolveConfig } from "../kepler";
import { printSolarStatus } from "./formatters";

export function createSolarCommand(): Command {
  const solarCommand = new Command("solar");

  solarCommand.description("Inspect current Kepler world sunlight without changing local habitat state.");

  solarCommand
    .command("status")
    .description("Show the current Kepler solar irradiance and condition.")
    .action(async () => {
      const config = resolveConfig(process.cwd());
      printSolarStatus(await getSolarIrradiance(config));
    });

  return solarCommand;
}
