import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createApp } from "./app";
import { advanceTicks, registerHabitat, scanWorld } from "./habitat-service";
import {
  readAlerts,
  readCurrentTick,
  readExplorationState,
  readHumans,
  readInventory,
  readModules,
  readRegistration,
  writeAlertContract,
  writeExplorationState,
  writeInventory,
  writeModules,
  writeRegistration,
} from "./registration-store";

test("registration hydrates starter modules into backend SQLite and REST reads them", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-backend-"));
  const originalFetch = globalThis.fetch;
  const starterModules = [
    {
      id: "module-command-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: ["habitat-command"],
    },
    {
      id: "module-suitport-1",
      blueprintId: "basic-suitport",
      displayName: "Basic Suitport",
      connectedTo: ["module-command-1"],
      runtimeAttributes: { status: "idle" },
      capabilities: ["basic-suitport"],
    },
  ];
  const starterHumans = [
    {
      id: "human-1",
      displayName: "Crew Member 1",
      locationModuleId: "module-command-1",
    },
    {
      id: "human-2",
      displayName: "Crew Member 2",
      locationModuleId: "module-suitport-1",
    },
  ];
  const contracts = {
    alerts: {
      schemaVersion: "1.0",
      schema: {
        type: "object",
        required: ["kind", "severity", "status"],
      },
    },
  };

  const mockedFetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/habitats/register")) {
      return new Response(JSON.stringify({
        habitatId: "habitat-1",
        streamUrl: "wss://planet.turingguild.com/planet/stream",
        apiToken: "kepler-stream-token",
        stream: {
          protocolVersion: "1.0",
          subscriptions: ["ticks"],
          currentTick: 0,
          tickIntervalMs: 1000,
          ticksPerPulse: 1,
          status: "paused",
        },
        contracts,
        starterModules,
        starterHumans,
        blueprints: [],
      }), {
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
    expect(result.response.starterHumans).toEqual(starterHumans);
    expect(result.response.contracts.alerts).toEqual(contracts.alerts);
    expect(result.response.starterModules.some((module) => module.capabilities.includes("basic-suitport"))).toBe(true);

    const app = createApp({ cwd });
    const modulesResponse = await app.request("/modules");
    expect(modulesResponse.status).toBe(200);
    expect(await modulesResponse.json()).toHaveLength(starterModules.length);
    expect(readHumans(cwd)).toEqual(starterHumans);

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

test("scanWorld uses the deployed explorer's saved position when calling Kepler", async () => {
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
  writeExplorationState(cwd, {
    deployedHumanId: "human-1",
    x: 10,
    y: -3,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
    batteryPercent: 100,
    maxBatteryPercent: 100,
    batteryDrainPerTickPercent: 10,
    oxygenUnits: 80,
    maxOxygenUnits: 80,
    oxygenDrainPerTickUnits: 10,
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

test("scanWorld rejects scans without a deployed human without changing EVA state", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-scan-no-explorer-"));
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-scan",
    habitatId: "habitat-scan-1",
    displayName: "Scan Habitat",
    apiToken: "token-scan",
    moduleCount: 1,
  });
  const before = readExplorationState(cwd);
  globalThis.fetch = Object.assign(async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({}), { status: 200 });
  }, { preconnect: () => {} }) as typeof fetch;

  try {
    await expect(scanWorld(cwd, { sensorStrength: 80, radiusTiles: 4 })).rejects.toThrow(
      "No human is currently deployed.",
    );
    expect(fetchCalled).toBe(false);
    expect(readExplorationState(cwd)).toEqual(before);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("scanWorld rejects scans after suit battery is exhausted without changing EVA state", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-scan-exhausted-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-scan",
    habitatId: "habitat-scan-1",
    displayName: "Scan Habitat",
    apiToken: "token-scan",
    moduleCount: 1,
  });
  writeExplorationState(cwd, {
    deployedHumanId: "human-1",
    x: 1,
    y: 2,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
    batteryPercent: 0,
    maxBatteryPercent: 100,
    batteryDrainPerTickPercent: 10,
    oxygenUnits: 60,
    maxOxygenUnits: 80,
    oxygenDrainPerTickUnits: 10,
  });

  try {
    const before = readExplorationState(cwd);
    await expect(scanWorld(cwd, { sensorStrength: 80, radiusTiles: 4 })).rejects.toThrow(
      "Explorer battery is exhausted. The explorer did not return in time.",
    );
    expect(readExplorationState(cwd)).toEqual(before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("scanWorld rejects scans after suit oxygen is exhausted with a client error and leaves EVA state unchanged", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-scan-oxygen-exhausted-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-scan",
    habitatId: "habitat-scan-1",
    displayName: "Scan Habitat",
    apiToken: "token-scan",
    moduleCount: 1,
  });
  writeExplorationState(cwd, {
    deployedHumanId: "human-1",
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
    batteryPercent: 20,
    maxBatteryPercent: 100,
    batteryDrainPerTickPercent: 10,
    oxygenUnits: 0,
    maxOxygenUnits: 80,
    oxygenDrainPerTickUnits: 10,
  });

  try {
    const before = readExplorationState(cwd);
    await expect(scanWorld(cwd, { sensorStrength: 100, radiusTiles: 0 })).rejects.toMatchObject({
      name: "HabitatServiceClientError",
      status: 400,
      message: "Explorer oxygen is exhausted. The explorer did not return in time.",
    });
    expect(readExplorationState(cwd)).toEqual(before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("advanceTicks drains suit resources, creates related alerts, and persists the exhausted state", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-tick-eva-drain-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-tick",
    habitatId: "habitat-tick-1",
    displayName: "Tick Habitat",
    apiToken: "token-tick",
    moduleCount: 1,
  });
  writeAlertContract(cwd, {
    schemaVersion: "1.0",
    schema: {
      type: "object",
      required: ["kind", "severity", "status"],
    },
  });
  writeModules(cwd, [
    {
      id: "module-suitport-1",
      blueprintId: "basic-suitport",
      displayName: "Basic Suitport",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: ["basic-suitport"],
      source: "registration",
    },
  ]);
  writeExplorationState(cwd, {
    deployedHumanId: "human-1",
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
    batteryPercent: 30,
    maxBatteryPercent: 100,
    batteryDrainPerTickPercent: 10,
    oxygenUnits: 20,
    maxOxygenUnits: 80,
    oxygenDrainPerTickUnits: 10,
  });

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  try {
    const result = await advanceTicks(cwd, 2);
    expect(result.endTick).toBe(2);
    expect(readCurrentTick(cwd)).toBe(2);
    expect(readExplorationState(cwd)).toEqual({
      deployedHumanId: "human-1",
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
      batteryPercent: 10,
      maxBatteryPercent: 100,
      batteryDrainPerTickPercent: 10,
      oxygenUnits: 0,
      maxOxygenUnits: 80,
      oxygenDrainPerTickUnits: 10,
    });
    expect(readAlerts(cwd)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "alert:eva-battery-low:human-1", status: "open" }),
      expect.objectContaining({ id: "alert:eva-oxygen-low:human-1", status: "open" }),
      expect.objectContaining({ id: "alert:eva-oxygen-exhausted:human-1", status: "open" }),
    ]));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("advanceTicks does not drain suit resources when nobody is deployed", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-tick-eva-inside-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-tick",
    habitatId: "habitat-tick-1",
    displayName: "Tick Habitat",
    apiToken: "token-tick",
    moduleCount: 1,
  });
  writeModules(cwd, [
    {
      id: "module-suitport-1",
      blueprintId: "basic-suitport",
      displayName: "Basic Suitport",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: ["basic-suitport"],
      source: "registration",
    },
  ]);

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  try {
    const before = readExplorationState(cwd);
    await advanceTicks(cwd, 3);
    expect(readExplorationState(cwd)).toEqual(before);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("advanceTicks rolls back tick count, power state, suit resources, and alerts together when alert persistence fails", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-tick-eva-rollback-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-tick",
    habitatId: "habitat-tick-1",
    displayName: "Tick Habitat",
    apiToken: "token-tick",
    moduleCount: 1,
  });
  writeAlertContract(cwd, {
    schemaVersion: "1.0",
    schema: {
      type: "object",
      required: ["kind", "severity", "status"],
    },
  });
  writeModules(cwd, [
    {
      id: "module-battery-1",
      blueprintId: "basic-battery",
      displayName: "Basic Battery",
      connectedTo: [],
      runtimeAttributes: {
        status: "active",
        currentEnergyKwh: 10,
        energyStorageKwh: 10,
        powerDrawKw: { active: 3.6 },
      },
      capabilities: ["power-storage"],
      source: "registration",
    },
  ]);
  writeExplorationState(cwd, {
    deployedHumanId: "human-1",
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
    batteryPercent: 30,
    maxBatteryPercent: 100,
    batteryDrainPerTickPercent: 10,
    oxygenUnits: 30,
    maxOxygenUnits: 80,
    oxygenDrainPerTickUnits: 10,
  });

  const database = new Database(path.join(cwd, ".habitat", "habitat.sqlite"));
  database.exec(`
    CREATE TRIGGER fail_alert_insert
    BEFORE INSERT ON alerts
    BEGIN
      SELECT RAISE(ABORT, 'alert insert blocked');
    END;
  `);

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  try {
    const tickBefore = readCurrentTick(cwd);
    const modulesBefore = readModules(cwd);
    const explorationBefore = readExplorationState(cwd);
    const alertsBefore = readAlerts(cwd);

    await expect(advanceTicks(cwd, 1)).rejects.toThrow("alert insert blocked");
    expect(readCurrentTick(cwd)).toBe(tickBefore);
    expect(readModules(cwd)).toEqual(modulesBefore);
    expect(readExplorationState(cwd)).toEqual(explorationBefore);
    expect(readAlerts(cwd)).toEqual(alertsBefore);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
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
        streamUrl: "wss://planet.turingguild.com/planet/stream",
        apiToken: "kepler-stream-token",
        stream: {
          protocolVersion: "1.0",
          subscriptions: ["ticks"],
          currentTick: 0,
          tickIntervalMs: 1000,
          ticksPerPulse: 1,
          status: "paused",
        },
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: { type: "object" },
          },
        },
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
        starterHumans: [
          {
            id: "human-1",
            displayName: "Crew Member 1",
            locationModuleId: "module-command-1",
          },
          {
            id: "human-2",
            displayName: "Crew Member 2",
            locationModuleId: "module-lab-1",
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
    expect(readHumans(cwd)).toEqual([
      {
        id: "human-1",
        displayName: "Crew Member 1",
        locationModuleId: "module-command-1",
      },
      {
        id: "human-2",
        displayName: "Crew Member 2",
        locationModuleId: "module-lab-1",
      },
    ]);
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
