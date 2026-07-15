import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import { printAlertList } from "./formatters";

export function createAlertCommand(): Command {
  const alertCommand = new Command("alert");
  alertCommand.description("List and acknowledge locally persisted habitat alerts.");

  alertCommand
    .command("list")
    .description("List persisted local alerts.")
    .option("--json", "Print alerts as JSON")
    .action(async (options: { json?: boolean }) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const alerts = await api.listAlerts();

      if (options.json === true) {
        console.log(JSON.stringify(alerts, null, 2));
        return;
      }

      printAlertList(alerts);
    });

  alertCommand
    .command("acknowledge")
    .description("Acknowledge one persisted local alert.")
    .argument("<alert-id>", "Alert id to acknowledge")
    .action(async (alertId: string) => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      await api.acknowledgeAlert(alertId);
      console.log(`Acknowledged alert "${alertId}".`);
    });

  return alertCommand;
}
