import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import { printHumanList } from "./formatters";

export function createHumanCommand(): Command {
  const humanCommand = new Command("human");

  humanCommand.description("Inspect the humans stored in the local habitat state.");

  humanCommand
    .command("list")
    .description("List humans currently stored in the local habitat state.")
    .option("--json", "Print the stored humans as JSON")
    .action(async (options: { json?: boolean }) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const humans = await api.listHumans();

      if (options.json === true) {
        console.log(JSON.stringify(humans, null, 2));
        return;
      }

      printHumanList(humans);
    });

  humanCommand
    .command("move")
    .description("Move one human into another local habitat module.")
    .argument("<human-id>", "Human id")
    .argument("<module-id>", "Destination module id")
    .action(async (humanId: string, moduleId: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const human = await api.moveHuman(humanId, moduleId);
      console.log(`Moved human "${human.id}" to "${human.locationModuleId}".`);
    });

  return humanCommand;
}
