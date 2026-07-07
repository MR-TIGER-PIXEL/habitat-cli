#!/usr/bin/env bun

import { Command } from "commander";
import packageJson from "../package.json";
import {
  CliError,
  createModule,
  deleteModule,
  formatModuleListEntry,
  getRegistrationStatus,
  listModules,
  parseJsonArray,
  parseJsonObject,
  registerHabitat,
  resolveConfig,
  showModule,
  unregisterHabitat,
  updateModule,
} from "./kepler";

const program = new Command();
const moduleCommand = new Command("module");

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
    const result = await registerHabitat(config, options.name);

    console.log(`Registered habitat "${result.registration.displayName}".`);
    console.log(`habitatId: ${result.registration.habitatId}`);
    console.log(`habitatUuid: ${result.registration.habitatUuid}`);
    console.log(`moduleCount: ${result.modules.length}`);
    console.log(`saved: .habitat/registration.json`);
    console.log(`saved: .habitat/modules.json`);
    console.log(`saved: .habitat/blueprints.json`);
  });

program
  .command("status")
  .description("Show the locally saved registration, module count, and current remote habitat status.")
  .action(async () => {
    const config = resolveConfig(process.cwd());
    const result = await getRegistrationStatus(config);

    console.log(`displayName: ${result.registration.displayName}`);
    console.log(`habitatId: ${result.registration.habitatId}`);
    console.log(`habitatUuid: ${result.registration.habitatUuid}`);
    console.log(`baseUrl: ${result.registration.baseUrl}`);
    console.log(`moduleCount: ${result.moduleCount}`);
    console.log(`habitatSlug: ${result.habitat.habitatSlug}`);
    console.log(`status: ${result.habitat.status}`);
    console.log(`catalogVersion: ${result.habitat.catalogVersion}`);
    console.log(`lastSeenAt: ${result.habitat.lastSeenAt ?? "(never)"}`);
  });

moduleCommand.description("Create, inspect, update, list, and delete local habitat modules.");

moduleCommand
  .command("create")
  .description("Create a local habitat module record.")
  .requiredOption("--id <id>", "Module id")
  .requiredOption("--blueprint-id <blueprintId>", "Official blueprint id")
  .requiredOption("--name <name>", "Module display name")
  .option("--connected-to <json>", "JSON array of connected module ids")
  .option("--runtime-attributes <json>", "JSON object of runtime attributes")
  .option("--capabilities <json>", "JSON array of capability strings")
  .action(
    (options: {
      id: string;
      blueprintId: string;
      name: string;
      connectedTo?: string;
      runtimeAttributes?: string;
      capabilities?: string;
    }) => {
      const config = resolveConfig(process.cwd());
      const module = createModule(config, {
        id: options.id,
        blueprintId: options.blueprintId,
        displayName: options.name,
        connectedTo:
          options.connectedTo !== undefined
            ? parseJsonArray(options.connectedTo, "connected-to")
            : undefined,
        runtimeAttributes:
          options.runtimeAttributes !== undefined
            ? parseJsonObject(options.runtimeAttributes, "runtime-attributes")
            : undefined,
        capabilities:
          options.capabilities !== undefined
            ? parseJsonArray(options.capabilities, "capabilities")
            : undefined,
      });

      console.log(`Created module "${module.id}".`);
    },
  );

moduleCommand
  .command("list")
  .description("List local habitat modules.")
  .action(() => {
    const config = resolveConfig(process.cwd());
    const modules = listModules(config);

    if (modules.length === 0) {
      console.log("No modules found.");
      return;
    }

    for (const module of modules) {
      console.log(formatModuleListEntry(module, modules));
    }
  });

moduleCommand
  .command("show")
  .description("Show one local habitat module.")
  .argument("<id>", "Module id or short alias")
  .action((moduleId: string) => {
    const config = resolveConfig(process.cwd());
    const result = showModule(config, moduleId);

    console.log(`alias: ${formatModuleListEntry(result.module, listModules(config)).split(" | ")[0]}`);
    console.log(`id: ${result.module.id}`);
    console.log(`blueprintId: ${result.module.blueprintId}`);
    console.log(`displayName: ${result.module.displayName}`);
    console.log(`source: ${result.module.source}`);
    console.log(`connectedTo: ${JSON.stringify(result.module.connectedTo)}`);
    console.log(`capabilities: ${JSON.stringify(result.module.capabilities)}`);
    console.log(`runtimeAttributes: ${JSON.stringify(result.module.runtimeAttributes)}`);

    if (!result.blueprint) {
      console.log("officialBlueprint: (none)");
      return;
    }

    console.log("officialBlueprint:");
    console.log(`  blueprintId: ${result.blueprint.blueprintId}`);
    console.log(`  displayName: ${result.blueprint.displayName}`);
    console.log(`  status: ${result.blueprint.status}`);
  });

moduleCommand
  .command("update")
  .description("Update one local habitat module.")
  .argument("<id>", "Module id or short alias")
  .option("--name <name>", "Updated display name")
  .option("--connected-to <json>", "Replacement JSON array of connected module ids")
  .option("--runtime-attributes <json>", "Replacement JSON object of runtime attributes")
  .option("--capabilities <json>", "Replacement JSON array of capability strings")
  .action(
    (
      moduleId: string,
      options: {
        name?: string;
        connectedTo?: string;
        runtimeAttributes?: string;
        capabilities?: string;
      },
    ) => {
      const config = resolveConfig(process.cwd());
      const module = updateModule(config, moduleId, {
        displayName: options.name,
        connectedTo:
          options.connectedTo !== undefined
            ? parseJsonArray(options.connectedTo, "connected-to")
            : undefined,
        runtimeAttributes:
          options.runtimeAttributes !== undefined
            ? parseJsonObject(options.runtimeAttributes, "runtime-attributes")
            : undefined,
        capabilities:
          options.capabilities !== undefined
            ? parseJsonArray(options.capabilities, "capabilities")
            : undefined,
      });

      console.log(`Updated module "${module.id}".`);
    },
  );

moduleCommand
  .command("delete")
  .description("Delete one local habitat module.")
  .argument("<id>", "Module id or short alias")
  .action((moduleId: string) => {
    const config = resolveConfig(process.cwd());
    const module = deleteModule(config, moduleId);

    console.log(`Deleted module "${module.id}".`);
  });

program.addCommand(moduleCommand);

program
  .command("unregister")
  .description("Delete the remote habitat registration and remove the saved local registration.")
  .action(async () => {
    const config = resolveConfig(process.cwd());
    const registration = await unregisterHabitat(config);

    console.log(`Unregistered habitat "${registration.displayName}".`);
    console.log(`removed: .habitat/registration.json`);
    console.log(`removed: .habitat/modules.json`);
    console.log(`removed: .habitat/blueprints.json`);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(error instanceof CliError ? 1 : 1);
  }
}

await main();
