import { Command } from "commander";
import { createBackendApiClient } from "../api/backend-api";
import { resolveBackendApiBaseUrl } from "../api/config";
import { printClockEvent, printClockStatus } from "./formatters";

export function createClockCommand(getGlobalOptions: () => { json?: boolean; jsonl?: boolean }): Command {
  const clockCommand = new Command("clock");

  clockCommand.description("Inspect persisted local clock status.");

  clockCommand
    .command("status")
    .description("Show the persisted local clock status.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.clockStatus();

      if (getGlobalOptions().json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printClockStatus(result);
    });

  clockCommand
    .command("watch")
    .description("Watch future local clock events from the backend SSE stream.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const controller = new AbortController();
      const handleSigint = () => controller.abort();
      process.once("SIGINT", handleSigint);

      try {
        await api.watchClockEvents({
          signal: controller.signal,
          onEvent(event) {
            if (getGlobalOptions().jsonl === true) {
              console.log(JSON.stringify(event));
              return;
            }
            printClockEvent(event);
          },
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
      } finally {
        process.removeListener("SIGINT", handleSigint);
      }
    });

  const listenCommand = new Command("listen");
  listenCommand.description("Control backend-owned Kepler clock listening.");

  listenCommand
    .command("on")
    .description("Enable backend-owned Kepler listening.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.clockListenOn();

      if (getGlobalOptions().json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printClockStatus(result);
    });

  listenCommand
    .command("off")
    .description("Disable backend-owned Kepler listening.")
    .action(async () => {
      const api = createBackendApiClient({ baseUrl: resolveBackendApiBaseUrl(process.cwd()) });
      const result = await api.clockListenOff();

      if (getGlobalOptions().json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printClockStatus(result);
    });

  clockCommand.addCommand(listenCommand);

  return clockCommand;
}
