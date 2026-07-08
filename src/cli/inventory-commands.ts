import { Command } from "commander";
import { addInventoryResource, listInventory, resolveConfig } from "../kepler";
import { printInventoryList } from "./formatters";
import { parsePositiveInteger } from "./parsers";

export function createInventoryCommand(): Command {
  const inventoryCommand = new Command("inventory");

  inventoryCommand.description("Manage local habitat inventory without Kepler resource validation.");

  inventoryCommand
    .command("add")
    .description("Add a quantity of one resource type to local habitat inventory.")
    .argument("<resource-type>", "Local resource type string")
    .argument("<quantity>", "Quantity to add", (value: string) => parsePositiveInteger(value, "quantity"))
    .action((resourceType: string, quantity: number) => {
      const config = resolveConfig(process.cwd());
      const result = addInventoryResource(config, resourceType, quantity);
      console.log(`Added ${quantity} of "${result.resourceType}" to local inventory.`);
      console.log(`newQuantity: ${result.quantity}`);
    });

  inventoryCommand
    .command("list")
    .description("List local habitat inventory entries.")
    .action(() => {
      const config = resolveConfig(process.cwd());
      printInventoryList(listInventory(config));
    });

  return inventoryCommand;
}
