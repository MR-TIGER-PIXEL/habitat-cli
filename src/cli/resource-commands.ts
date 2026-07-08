import { Command } from "commander";
import { listOfficialResources, resolveConfig } from "../kepler";
import { printResourceList } from "./formatters";

export function createResourceCommand(): Command {
  const resourceCommand = new Command("resource");

  resourceCommand.description("Inspect the official Kepler resource catalog without changing local state.");

  resourceCommand
    .command("list")
    .description("List official Kepler resource catalog entries.")
    .action(async () => {
      const config = resolveConfig(process.cwd());
      printResourceList(await listOfficialResources(config));
    });

  return resourceCommand;
}
