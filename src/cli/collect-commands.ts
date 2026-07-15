import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";

export function createCollectCommand(): Command {
  return new Command("collect")
    .description("Collect material from the deployed explorer's current tile.")
    .argument("<quantity-kg>", "Positive whole kilograms to collect")
    .action(async (quantityKg: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.collectMaterial(quantityKg);
      console.log(`Collected ${result.collectedKg} kg of ${result.resourceType}.`);
    });
}
