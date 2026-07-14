import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { createApp } from "./app";
import { registerHabitat, scanWorld } from "./habitat-service";
import { readInventory, readModules, readRegistration, writeInventory, writeModules, writeRegistration } from "./registration-store";

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

test("scanWorld loads the saved habitatId and calls Kepler GET /world/scan with validated query parameters", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-scan-"));
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  writeRegistration(cwd, {
    habitatUuid: "uuid-scan",
    habitatId: "habitat-scan-1",
    displayName: "Scan Habitat",
    apiToken: "token-scan",
    moduleCount: 1,
  });

  const mockedFetch = Object.assign(async (input: RequestInfo | URL) => {
    requests.push(String(input));

    return new Response(JSON.stringify({
      scanId: "scan-123",
      results: [{ resourceType: "water-ice", x: 10, y: -3 }],
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
    const result = await scanWorld(cwd, {
      x: 10,
      y: -3,
      sensorStrength: 80,
      radiusTiles: 4,
    });

    expect(result).toEqual({
      scanId: "scan-123",
      results: [{ resourceType: "water-ice", x: 10, y: -3 }],
    });
    expect(requests).toEqual([
      "https://kepler.test/world/scan?habitatId=habitat-scan-1&x=10&y=-3&sensorStrength=80&radiusTiles=4",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.KEPLER_BASE_URL;
    else process.env.KEPLER_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.KEPLER_PLANET_TOKEN;
    else process.env.KEPLER_PLANET_TOKEN = previousToken;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("registerHabitat repairs a stale local registration by re-registering the stored UUID and preserving local state", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-reregister-"));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: string }> = [];

  writeRegistration(cwd, {
    habitatUuid: "uuid-stale-1",
    habitatId: "habitat-stale-1",
    displayName: "Artemis Ridge",
    apiToken: "local-api-token",
    moduleCount: 2,
  });
  writeModules(cwd, [
    {
      id: "module-command-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: [],
      source: "registration",
    },
    {
      id: "module-lab-1",
      blueprintId: "lab-module",
      displayName: "Lab Module",
      connectedTo: [],
      runtimeAttributes: { status: "online" },
      capabilities: [],
      source: "local",
    },
  ]);
  writeInventory(cwd, { ferrite: 90, water: 12 });

  const mockedFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    requests.push({ url, method, body });

    if (url.endsWith("/habitats/habitat-stale-1/registration")) {
      return new Response(JSON.stringify({
        error: { code: "habitat_not_registered", message: "Habitat is not registered." },
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/habitats/register")) {
      return new Response(JSON.stringify({
        habitatId: "habitat-repaired-1",
        starterModules: [
          {
            id: "starter-module-1",
            blueprintId: "starter-module",
            displayName: "Starter Module",
            connectedTo: [],
            runtimeAttributes: { status: "active" },
            capabilities: [],
          },
        ],
        blueprints: [],
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }, { preconnect: () => {} }) as typeof fetch;
  globalThis.fetch = mockedFetch;

  const previousBaseUrl = process.env.KEPLER_BASE_URL;
  const previousToken = process.env.KEPLER_PLANET_TOKEN;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  try {
    const result = await registerHabitat(cwd, "ignored-name");

    expect(requests).toEqual([
      {
        url: "https://kepler.test/habitats/habitat-stale-1/registration",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://kepler.test/habitats/register",
        method: "POST",
        body: JSON.stringify({
          displayName: "Artemis Ridge",
          habitatUuid: "uuid-stale-1",
        }),
      },
    ]);

    expect(result.registration).toEqual({
      habitatUuid: "uuid-stale-1",
      habitatId: "habitat-repaired-1",
      displayName: "Artemis Ridge",
      apiToken: "local-api-token",
      moduleCount: 2,
    });
    expect(readRegistration(cwd)).toEqual({
      habitatUuid: "uuid-stale-1",
      habitatId: "habitat-repaired-1",
      displayName: "Artemis Ridge",
      apiToken: "local-api-token",
      moduleCount: 2,
    });
    expect(readModules(cwd)).toHaveLength(2);
    expect(readInventory(cwd)).toEqual({ ferrite: 90, water: 12 });
    expect(result.response.habitatId).toBe("habitat-repaired-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.KEPLER_BASE_URL;
    else process.env.KEPLER_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.KEPLER_PLANET_TOKEN;
    else process.env.KEPLER_PLANET_TOKEN = previousToken;
    rmSync(cwd, { recursive: true, force: true });
  }
});
