import { Command } from "commander";
import packageJson from "../../package.json";
import { CliError, getRegistrationStatus, getSolarIrradiance, readTickState, registerHabitat, resolveConfig, runPowerTicks, unregisterHabitat } from "../kepler";
import { createBlueprintCommand } from "./blueprint-commands";
import { createConstructionCommand } from "./construction-commands";
import { createConstructCommand } from "./construct-commands";
import { printRegistrationStatus, printRegistrationSuccess, printTickResult, printUnregisterSuccess } from "./formatters";
import { createInventoryCommand } from "./inventory-commands";
import { createModuleCommand } from "./module-commands";
import { parseInteger } from "./parsers";
import { createResourceCommand } from "./resource-commands";
import { createSolarCommand } from "./solar-commands";

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
    .description("Register this CLI workspace as a habitat in Kepler.")
    .requiredOption("--name <name>", "Habitat display name")
    .action(async (options: { name: string }) => {
      const config = resolveConfig(process.cwd());
      printRegistrationSuccess(await registerHabitat(config, options.name));
    });

  program
    .command("status")
    .description("Show the locally saved registration, module count, and current remote habitat status.")
    .action(async () => {
      const config = resolveConfig(process.cwd());
      printRegistrationStatus(await getRegistrationStatus(config), readTickState(config.cwd).currentTick);
    });

  program
    .command("tick")
    .description("Advance the local habitat simulation by a number of power-only ticks.")
    .argument("<count>", "Number of ticks to advance", parseInteger)
    .action(async (count: number) => {
      const config = resolveConfig(process.cwd());
      const solarIrradiance = await getSolarIrradiance(config);
      printTickResult(runPowerTicks(config, count, solarIrradiance), count);
    });

  program.addCommand(createModuleCommand());
  program.addCommand(createInventoryCommand());
  program.addCommand(createBlueprintCommand());
  program.addCommand(createConstructCommand());
  program.addCommand(createConstructionCommand());
  program.addCommand(createResourceCommand());
  program.addCommand(createSolarCommand());

  program
    .command("unregister")
    .description("Delete the remote habitat registration and remove the saved local registration.")
    .action(async () => {
      const config = resolveConfig(process.cwd());
      printUnregisterSuccess((await unregisterHabitat(config)).displayName);
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
