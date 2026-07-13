import { createApp } from "./backend/app";

const app = createApp();
const host = process.env.HABITAT_API_HOST ?? "0.0.0.0";
const port = Number(process.env.HABITAT_API_PORT ?? 8787);

console.log(`Hono backend listening on http://${host}:${port}`);

Bun.serve({
  hostname: host,
  port,
  fetch: app.fetch,
});
