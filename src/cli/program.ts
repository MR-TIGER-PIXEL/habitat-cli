import { Command } from "commander";
import packageJson from "../../package.json";
import { CliError } from "../kepler";
import { createAlertCommand } from "./alert-commands";
import { createBlueprintCommand } from "./blueprint-commands";
import { createClockCommand } from "./clock-commands";
import { createConstructionCommand } from "./construction-commands";
import { createEvaCommand } from "./eva-commands";
import { createConstructCommand } from "./construct-commands";
import { createCollectCommand } from "./collect-commands";
import { printRegistrationStatus, printRegistrationSuccess, printTickResult, printUnregisterSuccess } from "./formatters";
import { createHumanCommand } from "./human-commands";
import { createInventoryCommand } from "./inventory-commands";
import { createModuleCommand } from "./module-commands";
import { parseInteger } from "./parsers";
import { createResourceCommand } from "./resource-commands";
import { createScanCommand } from "./scan-commands";
import { createSolarCommand } from "./solar-commands";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

type ProgramOptions = {
  globalJson: boolean;
  globalJsonl: boolean;
};

export function createProgram(): Command {
  return createProgramWithOptions({ globalJson: false, globalJsonl: false });
}

function createProgramWithOptions(options: ProgramOptions): Command {
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
  habitat scan --strength 60
  habitat collect 5
  habitat alert list
  habitat inventory add ferrite 90
  habitat inventory list
  habitat human list
  habitat eva status
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
      if (options.globalJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
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
  program.addCommand(createHumanCommand());
  program.addCommand(createAlertCommand());
  program.addCommand(createEvaCommand());
  program.addCommand(createInventoryCommand());
  program.addCommand(createBlueprintCommand());
  program.addCommand(createClockCommand(() => ({ json: options.globalJson, jsonl: options.globalJsonl })));
  program.addCommand(createConstructCommand());
  program.addCommand(createConstructionCommand());
  program.addCommand(createResourceCommand());
  program.addCommand(createSolarCommand());
  program.addCommand(createScanCommand());
  program.addCommand(createCollectCommand());

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
    const { argv, globalJson, globalJsonl } = extractGlobalOutputOptions(process.argv);
    await createProgramWithOptions({ globalJson, globalJsonl }).parseAsync(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(error instanceof CliError ? 1 : 1);
  }
}

function extractGlobalOutputOptions(argv: string[]): {
  argv: string[];
  globalJson: boolean;
  globalJsonl: boolean;
} {
  const userArgs = argv.slice(2);
  if (userArgs[0] !== "--json" && userArgs[0] !== "--jsonl") {
    return { argv, globalJson: false, globalJsonl: false };
  }

  const globalFlag = userArgs[0];
  const commandPath = userArgs.slice(1);
  const supportsGlobalJson =
    commandPath[0] === "status"
    || (commandPath[0] === "clock" && commandPath[1] === "status");
  const supportsGlobalJsonl =
    commandPath[0] === "clock" && commandPath[1] === "watch";

  if (globalFlag === "--json" && !supportsGlobalJson) {
    return { argv, globalJson: false, globalJsonl: false };
  }

  if (globalFlag === "--jsonl" && !supportsGlobalJsonl) {
    return { argv, globalJson: false, globalJsonl: false };
  }

  return {
    argv: [argv[0] ?? "bun", argv[1] ?? "habitat", ...commandPath],
    globalJson: globalFlag === "--json",
    globalJsonl: globalFlag === "--jsonl",
  };
}
