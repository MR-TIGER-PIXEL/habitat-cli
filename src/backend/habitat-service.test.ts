import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createApp } from "./app";
import { sharedClockEventBroker } from "./clock-events";
import type { ClockStreamController } from "./clock-stream-controller";
import { advanceTicks, listenClockOff, listenClockOn, registerHabitat, scanWorld } from "./habitat-service";
import {
  readAlerts,
  readClockState,
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

type ClockControllerStartInput = Parameters<ClockStreamController["start"]>[0];

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
    expect(result.registration?.apiToken).toBe("kepler-stream-token");
    expect(result.registration?.streamUrl).toBe("wss://planet.turingguild.com/planet/stream");
    expect(result.registration?.stream).toEqual({
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    });
    expect(result.response.starterHumans).toEqual(starterHumans);
    expect(result.response.contracts.alerts).toEqual(contracts.alerts);
    expect(result.response.starterModules.some((module) => module.capabilities.includes("basic-suitport"))).toBe(true);
    expect(readRegistration(cwd)?.apiToken).toBe("kepler-stream-token");
    expect(readRegistration(cwd)?.streamUrl).toBe("wss://planet.turingguild.com/planet/stream");
    expect(readRegistration(cwd)?.stream).toEqual({
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    });

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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
    streamUrl: null,
    stream: null,
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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    },
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
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        tickIntervalMs: 1000,
        ticksPerPulse: 1,
        status: "paused",
      },
      moduleCount: 2,
    });
    expect(readRegistration(cwd)).toEqual({
      habitatUuid: "uuid-stale-1",
      habitatId: "habitat-repaired-1",
      displayName: "Artemis Ridge",
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        tickIntervalMs: 1000,
        ticksPerPulse: 1,
        status: "paused",
      },
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

test("registerHabitat upgrades an incomplete legacy registration by re-registering the stored UUID and preserving local state", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-reregister-incomplete-"));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body?: string }> = [];

  writeRegistration(cwd, {
    habitatUuid: "uuid-incomplete-1",
    habitatId: "habitat-incomplete-1",
    displayName: "Legacy Habitat",
    apiToken: "",
    streamUrl: null,
    stream: null,
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

    if (url.endsWith("/habitats/register")) {
      return new Response(JSON.stringify({
        habitatId: "habitat-repaired-2",
        streamUrl: "wss://planet.turingguild.com/planet/stream",
        apiToken: "kepler-stream-token-upgraded",
        stream: {
          protocolVersion: "1.0",
          subscriptions: ["ticks"],
          currentTick: 12,
          tickIntervalMs: 1000,
          ticksPerPulse: 1,
          status: "running",
        },
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: { type: "object" },
          },
        },
        starterModules: [],
        starterHumans: [],
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
        url: "https://kepler.test/habitats/register",
        method: "POST",
        body: JSON.stringify({
          displayName: "Legacy Habitat",
          habitatUuid: "uuid-incomplete-1",
        }),
      },
    ]);
    expect(result.registration).toEqual({
      habitatUuid: "uuid-incomplete-1",
      habitatId: "habitat-repaired-2",
      displayName: "Legacy Habitat",
      apiToken: "kepler-stream-token-upgraded",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 12,
        tickIntervalMs: 1000,
        ticksPerPulse: 1,
        status: "running",
      },
      moduleCount: 2,
    });
    expect(readRegistration(cwd)).toEqual(result.registration);
    expect(readModules(cwd)).toHaveLength(2);
    expect(readInventory(cwd)).toEqual({ ferrite: 90, water: 12 });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.KEPLER_BASE_URL;
    else process.env.KEPLER_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.KEPLER_PLANET_TOKEN;
    else process.env.KEPLER_PLANET_TOKEN = previousToken;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("listenClockOn fails safely without saved stream credentials and leaves manual mode unchanged", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-listen-missing-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-missing",
    habitatId: "habitat-missing",
    displayName: "Missing Stream Habitat",
    apiToken: "",
    streamUrl: null,
    stream: null,
    moduleCount: 0,
  });

  await expect(listenClockOn(cwd)).rejects.toThrow("Missing saved Kepler stream credentials");
  expect(readClockState(cwd).mode).toBe("manual");
  expect(readClockState(cwd).connectionState).toBe("disconnected");
});

test("listenClockOn persists kepler mode before connection starts and disables manual ticks immediately", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-listen-order-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-listen",
    habitatId: "habitat-listen",
    displayName: "Listening Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  let startCalls = 0;
  const fakeController = {
    isStarted: () => false,
    start: () => {
      startCalls += 1;
      expect(readClockState(cwd).mode).toBe("kepler");
      expect(readClockState(cwd).connectionState).toBe("connecting");
    },
    stop: async () => {},
  };

  const result = await listenClockOn(cwd, fakeController);

  expect(startCalls).toBe(1);
  expect(result.mode).toBe("kepler");
  expect(result.manualTicksAllowed).toBe(false);
  await expect(advanceTicks(cwd, 1)).rejects.toThrow(
    "Manual ticks are unavailable while Kepler listening is enabled. Run habitat clock listen off to return to manual mode.",
  );
});

test("repeated listenClockOn does not start a duplicate stream client", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-listen-repeat-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-repeat",
    habitatId: "habitat-repeat",
    displayName: "Repeat Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  let startCalls = 0;
  let started = false;
  const fakeController = {
    isStarted: () => started,
    start: () => {
      startCalls += 1;
      started = true;
    },
    stop: async () => {
      started = false;
    },
  };

  await listenClockOn(cwd, fakeController);
  await listenClockOn(cwd, fakeController);

  expect(startCalls).toBe(1);
});

test("listenClockOn records a redacted error and keeps kepler mode when connection start fails", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-listen-error-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-error",
    habitatId: "habitat-error",
    displayName: "Error Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  const fakeController = {
    isStarted: () => false,
    start: () => {
      throw new Error("stream token invalid");
    },
    stop: async () => {},
  };

  const result = await listenClockOn(cwd, fakeController);

  expect(result.mode).toBe("kepler");
  expect(result.listening).toBe(true);
  expect(result.manualTicksAllowed).toBe(false);
  expect(result.connectionState).toBe("error");
  expect(result.lastErrorMessage).not.toContain("token");
});

test("listenClockOff waits for shutdown before returning manual mode and manual ticks", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-listen-off-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-off",
    habitatId: "habitat-off",
    displayName: "Off Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  await listenClockOn(cwd, {
    isStarted: () => false,
    start: () => {},
    stop: async () => {},
  });

  let resolveStop: (() => void) | undefined;
  const fakeController = {
    isStarted: () => true,
    start: () => {},
    stop: () => new Promise<void>((resolve) => {
      resolveStop = resolve;
    }),
  };

  let statusDuringStop: "manual" | "kepler" | null = null;
  const stopping = listenClockOff(cwd, fakeController).then((result) => {
    statusDuringStop = result.mode;
    return result;
  });

  expect(readClockState(cwd).mode).toBe("kepler");
  if (resolveStop !== undefined) {
    resolveStop();
  }
  const result = await stopping;

  expect(result.mode).toBe("manual");
  expect(result.manualTicksAllowed).toBe(true);
  expect(readClockState(cwd).connectionState).toBe("disconnected");
  expect(statusDuringStop as "manual" | "kepler" | null).toBe("manual");
});

test("kepler planet_tick advances exactly by advancedBy and records the absolute watermark", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-kepler-tick-advanced-by-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-kepler-tick",
    habitatId: "habitat-kepler-tick",
    displayName: "Kepler Tick Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  let onPlanetTick: ClockControllerStartInput["onPlanetTick"] | undefined;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: (input) => {
      onPlanetTick = input.onPlanetTick;
    },
    stop: async () => {},
  };

  try {
    await listenClockOn(cwd, fakeController);
    await onPlanetTick?.({
      previousTick: 800,
      tick: 900,
      advancedBy: 100,
      issuedAt: "2026-07-15T14:30:00.000Z",
    });

    expect(readCurrentTick(cwd)).toBe(100);
    expect(readClockState(cwd).latestAbsoluteKeplerTick).toBe(900);
    expect(readClockState(cwd).latestAdvancedBy).toBe(100);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("kepler planet_tick ignores duplicate and older absolute ticks without catch-up", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-kepler-tick-dedupe-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-kepler-dedupe",
    habitatId: "habitat-kepler-dedupe",
    displayName: "Kepler Dedupe Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  let onPlanetTick: ClockControllerStartInput["onPlanetTick"] | undefined;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: (input) => {
      onPlanetTick = input.onPlanetTick;
    },
    stop: async () => {},
  };

  try {
    await listenClockOn(cwd, fakeController);
    await onPlanetTick?.({ previousTick: 10, tick: 20, advancedBy: 10, issuedAt: "2026-07-15T14:30:00.000Z" });
    expect(readCurrentTick(cwd)).toBe(10);

    await onPlanetTick?.({ previousTick: 20, tick: 20, advancedBy: 99, issuedAt: "2026-07-15T14:31:00.000Z" });
    await onPlanetTick?.({ previousTick: 19, tick: 19, advancedBy: 50, issuedAt: "2026-07-15T14:32:00.000Z" });
    expect(readCurrentTick(cwd)).toBe(10);

    await onPlanetTick?.({ previousTick: 20, tick: 900, advancedBy: 1, issuedAt: "2026-07-15T14:33:00.000Z" });
    expect(readCurrentTick(cwd)).toBe(11);
    expect(readClockState(cwd).latestAbsoluteKeplerTick).toBe(900);
    expect(readClockState(cwd).latestAdvancedBy).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("applied kepler ticks publish the local clock event with applied true", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-kepler-event-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-kepler-event",
    habitatId: "habitat-kepler-event",
    displayName: "Kepler Event Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  const events: Array<{
    previousTick?: number | null;
    tick: number;
    advancedBy: number;
    issuedAt: string;
    applied: boolean;
  }> = [];
  const unsubscribe = sharedClockEventBroker.subscribe((event) => {
    events.push(event);
  });

  let onPlanetTick: ClockControllerStartInput["onPlanetTick"] | undefined;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: (input) => {
      onPlanetTick = input.onPlanetTick;
    },
    stop: async () => {},
  };

  try {
    await listenClockOn(cwd, fakeController);
    await onPlanetTick?.({
      previousTick: 800,
      tick: 900,
      advancedBy: 100,
      issuedAt: "2026-07-15T14:30:00.000Z",
    });

    expect(events).toContainEqual({
      previousTick: 800,
      tick: 900,
      advancedBy: 100,
      issuedAt: "2026-07-15T14:30:00.000Z",
      applied: true,
    });
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("applied kepler ticks update persisted clock status fields", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-kepler-status-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-kepler-status",
    habitatId: "habitat-kepler-status",
    displayName: "Kepler Status Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  globalThis.fetch = Object.assign(async () =>
    new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  let onPlanetTick: ClockControllerStartInput["onPlanetTick"] | undefined;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: (input) => {
      input.onAcknowledged(input.registration.habitatId);
      onPlanetTick = input.onPlanetTick;
    },
    stop: async () => {},
  };

  try {
    await listenClockOn(cwd, fakeController);
    await onPlanetTick?.({
      previousTick: 12,
      tick: 25,
      advancedBy: 10,
      issuedAt: "2026-07-15T14:30:00.000Z",
    });

    const clock = readClockState(cwd);
    expect(clock.connectionState).toBe("connected");
    expect(clock.latestAbsoluteKeplerTick).toBe(25);
    expect(clock.latestAdvancedBy).toBe(10);
    expect(clock.lastMessageAt).not.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("manual and kepler tick work is serialized through one backend queue", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-tick-serialization-"));
  const originalFetch = globalThis.fetch;

  writeRegistration(cwd, {
    habitatUuid: "uuid-serialized",
    habitatId: "habitat-serialized",
    displayName: "Serialized Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });

  let releaseSolar: (() => void) | undefined;
  let solarStarted = false;
  let resolveSolarStarted: (() => void) | undefined;
  const solarStartedPromise = new Promise<void>((resolve) => {
    resolveSolarStarted = resolve;
  });
  let solarFetchCount = 0;
  globalThis.fetch = Object.assign(async () => {
    solarFetchCount += 1;
    if (solarFetchCount === 1) {
      solarStarted = true;
      resolveSolarStarted?.();
      await new Promise<void>((resolve) => {
        releaseSolar = resolve;
      });
    }
    return new Response(JSON.stringify({ irradianceWPerM2: 0, condition: "night" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, { preconnect: () => {} }) as typeof fetch;
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";

  let onPlanetTick: ClockControllerStartInput["onPlanetTick"] | undefined;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: (input) => {
      onPlanetTick = input.onPlanetTick;
    },
    stop: async () => {},
  };

  try {
    const manualAdvance = advanceTicks(cwd, 1);
    await solarStartedPromise;
    expect(solarStarted).toBe(true);
    await listenClockOn(cwd, fakeController);
    const keplerAdvance = onPlanetTick?.({
      previousTick: 1,
      tick: 50,
      advancedBy: 10,
      issuedAt: "2026-07-15T14:30:00.000Z",
    });

    expect(readCurrentTick(cwd)).toBe(0);
    releaseSolar?.();
    await manualAdvance;
    await keplerAdvance;

    expect(readCurrentTick(cwd)).toBe(11);
    expect(readClockState(cwd).latestAbsoluteKeplerTick).toBe(50);
    expect(readClockState(cwd).latestAdvancedBy).toBe(10);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});
