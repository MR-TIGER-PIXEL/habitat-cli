import { Command } from "commander";
import packageJson from "../../package.json";
import { CliError } from "../kepler";
import { createBlueprintCommand } from "./blueprint-commands";
import { createConstructionCommand } from "./construction-commands";
import { createConstructCommand } from "./construct-commands";
import { printRegistrationStatus, printRegistrationSuccess, printTickResult, printUnregisterSuccess } from "./formatters";
import { createInventoryCommand } from "./inventory-commands";
import { createModuleCommand } from "./module-commands";
import { parseInteger } from "./parsers";
import { createResourceCommand } from "./resource-commands";
import { createScanCommand } from "./scan-commands";
import { createSolarCommand } from "./solar-commands";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("habitat")
    .description(
      "Register a habitat with Kepler, inspect registration status, and manage local habitat modules.",
    )
    .version(packageJson.version)
    .showHelpAfterError("(run `habitat --help` for command usage)")
    .addHelpText(
      "after",
      `
Examples:
  habitat register --name "Starlight Forge"
  habitat status
  habitat tick 60
  habitat solar status
  habitat scan --x 3 --y -2 --strength 60
  habitat inventory add ferrite 90
  habitat inventory list
  habitat construct small-solar-array --dry-run
  habitat construction status
  habitat module list
  habitat unregister
`,
    );

  program
    .command("register")
    .description("Register this CLI workspace through the backend.")
    .requiredOption("--name <name>", "Habitat display name")
    .action(async (options: { name: string }) => {
      const api = createBackendApiClient({
        baseUrl: resolveBackendApiBaseUrl(process.cwd()),
      });
      printRegistrationSuccess(await api.register(options.name));
    });

  program
    .command("status")
    .description("Show the backend-saved registration, module count, and current habitat status.")
    .action(async () => {
      const api = createBackendApiClient({
        baseUrl: resolveBackendApiBaseUrl(process.cwd()),
      });
      const result = await api.status();
      printRegistrationStatus(result);
    });

  program
    .command("tick")
    .description("Advance the local habitat simulation by a number of power-only ticks.")
    .argument("<count>", "Number of ticks to advance", parseInteger)
    .action(async (count: number) => {
      const api = createBackendApiClient({
        baseUrl: resolveBackendApiBaseUrl(process.cwd()),
      });
      printTickResult(await api.tick(count), count);
    });

  program.addCommand(createModuleCommand());
  program.addCommand(createInventoryCommand());
  program.addCommand(createBlueprintCommand());
  program.addCommand(createConstructCommand());
  program.addCommand(createConstructionCommand());
  program.addCommand(createResourceCommand());
  program.addCommand(createSolarCommand());
  program.addCommand(createScanCommand());

  program
    .command("unregister")
    .description("Delete the backend registration and remove the saved backend state.")
    .action(async () => {
      const api = createBackendApiClient({
        baseUrl: resolveBackendApiBaseUrl(process.cwd()),
      });
      printUnregisterSuccess((await api.unregister()).registration.displayName);
    });

  return program;
}

export async function main(): Promise<void> {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(error instanceof CliError ? 1 : 1);
  }
}
