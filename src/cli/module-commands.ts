import { Argument, Command } from "commander";
import {
  MODULE_RUNTIME_STATUSES,
  parseJsonArray,
  parseJsonObject,
  type ModuleRuntimeStatus,
} from "../kepler";
import { printModuleDetails, printModuleList, printModuleStatus } from "./formatters";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

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
      async (options: {
        id: string;
        blueprintId: string;
        name: string;
        connectedTo?: string;
        runtimeAttributes?: string;
        capabilities?: string;
      }) => {
        const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
        const module = await api.createModule({
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
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printModuleList(await api.listModules());
    });

  moduleCommand
    .command("status")
    .description("Show local module runtime states and their current power draw.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printModuleStatus(await api.getModulePowerStatus());
    });

  moduleCommand
    .command("set-status")
    .description("Set one local module runtime status.")
    .argument("<id>", "Module id or short alias")
    .addArgument(
      new Argument("<status>", "New module runtime status").choices([...MODULE_RUNTIME_STATUSES]),
    )
    .action(async (moduleReference: string, status: ModuleRuntimeStatus) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.setModuleStatus(moduleReference, status);

      console.log(`Updated module "${moduleReference}".`);
      console.log(`status: ${result.module.runtimeAttributes.status}`);
      console.log(`currentPowerDrawKw: ${result.currentPowerDrawKw}`);
    });

  moduleCommand
    .command("show")
    .description("Show one local habitat module.")
    .argument("<id>", "Module id or short alias")
    .action(async (moduleId: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.getModule(moduleId);
      printModuleDetails(result.module, result.modules, result.blueprint);
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
      async (
        moduleId: string,
        options: {
          name?: string;
          connectedTo?: string;
          runtimeAttributes?: string;
          capabilities?: string;
        },
      ) => {
        const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
        const module = await api.updateModule(moduleId, {
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
    .action(async (moduleId: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const module = await api.deleteModule(moduleId);

      console.log(`Deleted module "${module.id}".`);
    });

  return moduleCommand;
}
