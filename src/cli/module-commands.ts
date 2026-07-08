import { Argument, Command } from "commander";
import {
  createModule,
  deleteModule,
  getModulePowerStatus,
  listModules,
  MODULE_RUNTIME_STATUSES,
  parseJsonArray,
  parseJsonObject,
  resolveConfig,
  setModuleStatus,
  showModule,
  updateModule,
  type ModuleRuntimeStatus,
} from "../kepler";
import { printModuleDetails, printModuleList, printModuleStatus } from "./formatters";

export function createModuleCommand(): Command {
  const moduleCommand = new Command("module");

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
      printModuleList(listModules(config));
    });

  moduleCommand
    .command("status")
    .description("Show local module runtime states and their current power draw.")
    .action(() => {
      const config = resolveConfig(process.cwd());
      printModuleStatus(getModulePowerStatus(config));
    });

  moduleCommand
    .command("set-status")
    .description("Set one local module runtime status.")
    .argument("<id>", "Module id or short alias")
    .addArgument(
      new Argument("<status>", "New module runtime status").choices([...MODULE_RUNTIME_STATUSES]),
    )
    .action((moduleReference: string, status: ModuleRuntimeStatus) => {
      const config = resolveConfig(process.cwd());
      const result = setModuleStatus(config, moduleReference, status);

      console.log(`Updated module "${moduleReference}".`);
      console.log(`status: ${result.module.runtimeAttributes.status}`);
      console.log(`currentPowerDrawKw: ${result.currentPowerDrawKw}`);
    });

  moduleCommand
    .command("show")
    .description("Show one local habitat module.")
    .argument("<id>", "Module id or short alias")
    .action((moduleId: string) => {
      const config = resolveConfig(process.cwd());
      const result = showModule(config, moduleId);
      printModuleDetails(result.module, listModules(config), result.blueprint);
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

  return moduleCommand;
}
