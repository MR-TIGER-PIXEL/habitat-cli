import { createApp } from "./backend/app";
import { shutdownBackendClockRuntime, startBackendClockRuntime } from "./backend/runtime";

const app = createApp();
const host = process.env.HABITAT_API_HOST ?? "0.0.0.0";
const port = Number(process.env.HABITAT_API_PORT ?? 8787);
const cwd = process.cwd();

console.log(`Hono backend listening on http://${host}:${port}`);

await startBackendClockRuntime(cwd);

const server = Bun.serve({
  hostname: host,
  port,
  fetch: app.fetch,
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  server.stop(true);
  await shutdownBackendClockRuntime(cwd);
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
