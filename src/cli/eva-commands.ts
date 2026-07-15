import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import { printEvaStatus } from "./formatters";
import { parseInteger } from "./parsers";

export function createEvaCommand(): Command {
  const evaCommand = new Command("eva");
  evaCommand.description("Deploy one explorer onto the local habitat exploration grid.");

  evaCommand
    .command("status")
    .description("Show the local EVA exploration state.")
    .option("--json", "Print the EVA state as JSON")
    .action(async (options: { json?: boolean }) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const status = await api.getEvaStatus();

      if (options.json === true) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      printEvaStatus(status);
    });

  evaCommand
    .command("deploy")
    .description("Deploy one human through the active Basic Suitport.")
    .argument("<human-id>", "Human id to deploy")
    .action(async (humanId: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const state = await api.deployHuman(humanId);
      console.log(`Deployed human "${humanId}" to EVA at (${state.x}, ${state.y}).`);
    });

  evaCommand
    .command("move")
    .description("Move the deployed explorer one adjacent grid tile.")
    .argument("<x>", "Destination x coordinate", parseInteger)
    .argument("<y>", "Destination y coordinate", parseInteger)
    .action(async (x: number, y: number) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const state = await api.moveExplorer(x, y);
      console.log(`Moved deployed explorer to (${state.x}, ${state.y}).`);
    });

  evaCommand
    .command("dock")
    .description("Dock the deployed explorer back at the habitat origin.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      await api.dockExplorer();
      console.log("Docked deployed explorer at (0, 0).");
    });

  return evaCommand;
}
