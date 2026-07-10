import { Command } from "commander";
import { printInventoryList } from "./formatters";
import { parsePositiveInteger } from "./parsers";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createInventoryCommand(): Command {
  const inventoryCommand = new Command("inventory");

  inventoryCommand.description("Manage local habitat inventory without Kepler resource validation.");

  inventoryCommand
    .command("add")
    .description("Add a quantity of one resource type to local habitat inventory.")
    .argument("<resource-type>", "Local resource type string")
    .argument("<quantity>", "Quantity to add", (value: string) => parsePositiveInteger(value, "quantity"))
    .action(async (resourceType: string, quantity: number) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.addInventory(resourceType, quantity);
      console.log(`Added ${quantity} of "${result.resourceType}" to local inventory.`);
      console.log(`newQuantity: ${result.quantity}`);
    });

  inventoryCommand
    .command("remove")
    .description("Remove a quantity of one resource type from local habitat inventory.")
    .argument("<resource-type>", "Local resource type string")
    .argument("<quantity>", "Quantity to remove", (value: string) => parsePositiveInteger(value, "quantity"))
    .action(async (resourceType: string, quantity: number) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.removeInventory(resourceType, quantity);
      console.log(`Removed ${quantity} of "${result.resourceType}" from local inventory.`);
      console.log(`newQuantity: ${result.quantity}`);
    });

  inventoryCommand
    .command("list")
    .description("List local habitat inventory entries.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      printInventoryList(await api.listInventory());
    });

  return inventoryCommand;
}
