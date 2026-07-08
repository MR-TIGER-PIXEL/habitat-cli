import { Command } from "commander";
import { getOfficialBlueprint, listOfficialBlueprints, resolveConfig } from "../kepler";
import { printBlueprintDetails, printBlueprintList } from "./formatters";

export function createBlueprintCommand(): Command {
  const blueprintCommand = new Command("blueprint");

  blueprintCommand.description("Inspect the official Kepler blueprint catalog without changing local state.");

  blueprintCommand
    .command("list")
    .description("List official Kepler blueprint catalog entries.")
    .action(async () => {
      const config = resolveConfig(process.cwd());
      printBlueprintList(await listOfficialBlueprints(config));
    });

  blueprintCommand
    .command("show")
    .description("Show one official Kepler blueprint catalog entry.")
    .argument("<blueprint-id>", "Official blueprint id")
    .action(async (blueprintId: string) => {
      const config = resolveConfig(process.cwd());
      printBlueprintDetails(await getOfficialBlueprint(config, blueprintId));
    });

  return blueprintCommand;
}
