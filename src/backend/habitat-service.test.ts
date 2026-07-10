import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { createApp } from "./app";
import { registerHabitat } from "./habitat-service";

test("registration hydrates starter modules into backend SQLite and REST reads them", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-backend-"));
  const originalFetch = globalThis.fetch;
  const starterModules = Array.from({ length: 6 }, (_, index) => ({
    id: `module-${index + 1}`,
    blueprintId: `blueprint-${index + 1}`,
    displayName: `Module ${index + 1}`,
    connectedTo: [],
    runtimeAttributes: { status: "active" },
    capabilities: [],
  }));

  const mockedFetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/habitats/register")) {
      return new Response(JSON.stringify({ habitatId: "habitat-1", starterModules, blueprints: [] }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      habitat: {
        habitatSlug: "test-habitat",
        status: "online",
        catalogVersion: "v1",
        lastSeenAt: null,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, { preconnect: () => {} }) as typeof fetch;
  globalThis.fetch = mockedFetch;

  const previousBaseUrl = process.env.KEPLER_BASE_URL;
  const previousToken = process.env.KEPLER_PLANET_TOKEN;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  try {
    const result = await registerHabitat(cwd, "Test Habitat");
    expect(result.registration).not.toBeNull();
    expect(result.registration?.moduleCount).toBe(starterModules.length);

    const app = createApp({ cwd });
    const modulesResponse = await app.request("/modules");
    expect(modulesResponse.status).toBe(200);
    expect(await modulesResponse.json()).toHaveLength(starterModules.length);

    const statusResponse = await app.request("/status");
    expect(statusResponse.status).toBe(200);
    expect((await statusResponse.json()).moduleCount).toBe(starterModules.length);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.KEPLER_BASE_URL;
    else process.env.KEPLER_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.KEPLER_PLANET_TOKEN;
    else process.env.KEPLER_PLANET_TOKEN = previousToken;
    rmSync(cwd, { recursive: true, force: true });
  }
});
