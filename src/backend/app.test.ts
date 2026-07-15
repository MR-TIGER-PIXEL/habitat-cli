import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { ApiError } from "../api/client";

test("GET /registration returns null when no registration is stored", async () => {
  const app = createApp({ readRegistration: () => null });

  const response = await app.request("/registration");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ registration: null });
});

test("GET /registration returns the stored registration as json", async () => {
  const app = createApp({
    readRegistration: () => ({
      habitatUuid: "uuid-123",
      habitatId: "habitat-123",
      displayName: "Starlight Forge",
      apiToken: "token-abc",
      moduleCount: 2,
    }),
  });

  const response = await app.request("/registration");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    registration: {
      habitatUuid: "uuid-123",
      habitatId: "habitat-123",
      displayName: "Starlight Forge",
      moduleCount: 2,
    },
  });
});

test("public registration responses and backend logs never expose API tokens", async () => {
  const storedToken = "token-sensitive-value";
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));

  try {
    const app = createApp({
      readRegistration: () => ({
        habitatUuid: "uuid-secure",
        habitatId: "habitat-secure",
        displayName: "Secure Habitat",
        apiToken: storedToken,
        moduleCount: 1,
      }),
      getStatus: async () => ({
        registration: {
          habitatUuid: "uuid-secure",
          habitatId: "habitat-secure",
          displayName: "Secure Habitat",
          apiToken: storedToken,
          moduleCount: 1,
        },
        habitat: { status: "online" },
        moduleCount: 1,
        currentTick: 0,
      }),
    });

    const registration = await app.request("/registration");
    const status = await app.request("/status");
    const registrationText = await registration.text();
    const statusText = await status.text();
    const logText = logs.join("\n");

    expect(registrationText).not.toContain("apiToken");
    expect(registrationText).not.toContain(storedToken);
    expect(statusText).not.toContain("apiToken");
    expect(statusText).not.toContain(storedToken);
    expect(logText).not.toContain("apiToken");
    expect(logText).not.toContain("Bearer");
    expect(logText).not.toContain(storedToken);
  } finally {
    console.log = originalLog;
  }
});

test("POST /registration and DELETE /registration use backend handlers", async () => {
  const app = createApp({
    registerHabitat: async (displayName: string) => ({
      registration: {
        habitatUuid: "uuid-456",
        habitatId: "habitat-456",
        displayName,
        apiToken: "token-def",
        moduleCount: 6,
      },
      response: {},
    }),
    getStatus: async () => ({
      registration: {
        habitatUuid: "uuid-456",
        habitatId: "habitat-456",
        displayName: "Artemis Ridge",
        apiToken: "token-def",
        moduleCount: 6,
      },
      habitat: {
        habitatSlug: "artemis-ridge",
        status: "online",
        catalogVersion: "v1",
        lastSeenAt: null,
      },
      moduleCount: 6,
      currentTick: 12,
    }),
    unregisterHabitat: async () => ({
      habitatUuid: "uuid-456",
      habitatId: "habitat-456",
      displayName: "Artemis Ridge",
      moduleCount: 6,
    }),
  });

  const registerResponse = await app.request("/registration", {
    method: "POST",
    body: JSON.stringify({ displayName: "Artemis Ridge" }),
    headers: { "content-type": "application/json" },
  });

  expect(registerResponse.status).toBe(201);
  expect(await registerResponse.json()).toEqual({
    registration: {
      habitatUuid: "uuid-456",
      habitatId: "habitat-456",
      displayName: "Artemis Ridge",
      moduleCount: 6,
    },
    response: {},
  });

  const statusResponse = await app.request("/status");
  expect(statusResponse.status).toBe(200);
  expect(await statusResponse.json()).toEqual({
    registration: {
      habitatUuid: "uuid-456",
      habitatId: "habitat-456",
      displayName: "Artemis Ridge",
      moduleCount: 6,
    },
    habitat: {
      habitatSlug: "artemis-ridge",
      status: "online",
      catalogVersion: "v1",
      lastSeenAt: null,
    },
    moduleCount: 6,
    currentTick: 12,
  });

  const unregisterResponse = await app.request("/registration", { method: "DELETE" });
  expect(unregisterResponse.status).toBe(200);
  expect(await unregisterResponse.json()).toEqual({
    registration: {
      habitatUuid: "uuid-456",
      habitatId: "habitat-456",
      displayName: "Artemis Ridge",
      moduleCount: 6,
    },
  });
});

test("catalog and solar routes proxy backend handlers", async () => {
  const app = createApp({
    listOfficialBlueprints: async () => ({
      catalogVersion: "catalog-1",
      blueprints: [
        {
          id: "blueprint-1",
          blueprintId: "survey-rover",
          displayName: "Survey Rover",
          description: "Builds a compact rover for local site surveys.",
          status: "published",
          output: { itemType: "vehicle", vehicleType: "survey-rover", quantity: 1 },
          inputs: { aluminum: 12 },
          buildTicks: 240,
          repeatable: true,
        },
      ],
    }),
    getOfficialBlueprint: async () => ({
      blueprint: {
        id: "blueprint-1",
        blueprintId: "survey-rover",
        displayName: "Survey Rover",
        description: "Builds a compact rover for local site surveys.",
        status: "published",
        output: { itemType: "vehicle", vehicleType: "survey-rover", quantity: 1 },
        inputs: { aluminum: 12 },
        buildTicks: 240,
        repeatable: true,
      },
    }),
    listOfficialResources: async () => ({
      catalogVersion: "catalog-1",
      resources: [
        {
          id: "resource-1",
          resourceType: "water-ice",
          displayName: "Water Ice",
          kind: "volatile",
          rarity: "common",
        },
      ],
    }),
    getSolarIrradiance: async () => ({
      irradianceWPerM2: 800,
      condition: "clear",
    }),
  });

  const blueprints = await app.request("/catalog/blueprints");
  expect(blueprints.status).toBe(200);
  expect(await blueprints.json()).toEqual({
    catalogVersion: "catalog-1",
    blueprints: [
      {
        id: "blueprint-1",
        blueprintId: "survey-rover",
        displayName: "Survey Rover",
        description: "Builds a compact rover for local site surveys.",
        status: "published",
        output: { itemType: "vehicle", vehicleType: "survey-rover", quantity: 1 },
        inputs: { aluminum: 12 },
        buildTicks: 240,
        repeatable: true,
      },
    ],
  });

  const blueprint = await app.request("/catalog/blueprints/survey-rover");
  expect(blueprint.status).toBe(200);
  expect(await blueprint.json()).toEqual({
    blueprint: {
      id: "blueprint-1",
      blueprintId: "survey-rover",
      displayName: "Survey Rover",
      description: "Builds a compact rover for local site surveys.",
      status: "published",
      output: { itemType: "vehicle", vehicleType: "survey-rover", quantity: 1 },
      inputs: { aluminum: 12 },
      buildTicks: 240,
      repeatable: true,
    },
  });

  const resources = await app.request("/catalog/resources");
  expect(resources.status).toBe(200);
  expect(await resources.json()).toEqual({
    catalogVersion: "catalog-1",
    resources: [
      {
        id: "resource-1",
        resourceType: "water-ice",
        displayName: "Water Ice",
        kind: "volatile",
        rarity: "common",
      },
    ],
  });

  const solar = await app.request("/solar/irradiance");
  expect(solar.status).toBe(200);
  expect(await solar.json()).toEqual({
    irradianceWPerM2: 800,
    condition: "clear",
  });
});

test("GET /scan validates query parameters, forwards them to the backend handler, and returns the scan unchanged", async () => {
  const app = createApp({
    scanWorld: async (input: {
      sensorStrength: number;
      radiusTiles: number;
    }) => ({
      habitatId: "habitat-123",
      echoed: input,
      tiles: [{ x: 4, y: -2, resourceType: "water-ice" }],
    }),
  });

  const response = await app.request(
    "/scan?sensorStrength=75&radiusTiles=3",
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    habitatId: "habitat-123",
    echoed: {
      sensorStrength: 75,
      radiusTiles: 3,
    },
    tiles: [{ x: 4, y: -2, resourceType: "water-ice" }],
  });
});

test("GET /scan returns clear client errors for invalid query parameters", async () => {
  const app = createApp({
    scanWorld: async () => {
      throw new Error("scanWorld should not be called for invalid input");
    },
  });

  const invalidSensorStrength = await app.request("/scan?sensorStrength=101&radiusTiles=3");
  expect(invalidSensorStrength.status).toBe(400);
  expect(await invalidSensorStrength.json()).toEqual({
    error: { message: 'Invalid sensorStrength "101". Use an integer from 0 through 100.' },
  });

  const invalidRadiusTiles = await app.request("/scan?sensorStrength=75&radiusTiles=6");
  expect(invalidRadiusTiles.status).toBe(400);
  expect(await invalidRadiusTiles.json()).toEqual({
    error: { message: 'Invalid radiusTiles "6". Use an integer from 0 through 5.' },
  });
});

test("GET /scan returns a clear error when no saved habitat registration exists", async () => {
  const app = createApp({
    scanWorld: async () => {
      throw new Error("No habitat registration found.");
    },
  });

  const response = await app.request("/scan?sensorStrength=75&radiusTiles=3");

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: { message: "No habitat registration found." },
  });
});

test("GET /scan preserves upstream error status and message", async () => {
  const app = createApp({
    scanWorld: async () => {
      throw new ApiError("Habitat is not registered.", 404, "application/json", '{"error":{"code":"habitat_not_registered","message":"Habitat is not registered."}}');
    },
  });

  const response = await app.request("/scan?sensorStrength=75&radiusTiles=3");

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: { message: "Habitat is not registered." },
  });
});

test("eva routes proxy backend handlers", async () => {
  const app = createApp({
    getEvaStatus: async () => ({
      deployedHumanId: null,
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    }),
    deployHuman: async (humanId: string) => ({
      deployedHumanId: humanId,
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    }),
    moveExplorer: async (input: { x: number; y: number }) => ({
      deployedHumanId: "human-1",
      x: input.x,
      y: input.y,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    }),
    dockExplorer: async () => ({
      deployedHumanId: null,
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    }),
  });

  const status = await app.request("/eva");
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual({
    deployedHumanId: null,
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
  });

  const deploy = await app.request("/eva/deploy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ humanId: "human-1" }),
  });
  expect(deploy.status).toBe(200);
  expect(await deploy.json()).toEqual({
    deployedHumanId: "human-1",
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
  });

  const move = await app.request("/eva/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x: 1, y: 0 }),
  });
  expect(move.status).toBe(200);
  expect(await move.json()).toEqual({
    deployedHumanId: "human-1",
    x: 1,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
  });

  const dock = await app.request("/eva/dock", { method: "POST" });
  expect(dock.status).toBe(200);
  expect(await dock.json()).toEqual({
    deployedHumanId: null,
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: 20,
  });
});

test("POST /collect validates quantity and proxies successful collection through the backend", async () => {
  const quantities: number[] = [];
  const app = createApp({
    collectMaterial: async (quantityKg: number) => {
      quantities.push(quantityKg);
      return { resourceType: "ferrite", collectedKg: quantityKg, remainingKg: 175 };
    },
  });

  const invalid = await app.request("/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quantityKg: "0" }),
  });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({
    error: { message: "Collection quantity must be a positive whole number of kilograms." },
  });

  const collected = await app.request("/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quantityKg: "5" }),
  });
  expect(collected.status).toBe(200);
  expect(await collected.json()).toEqual({ resourceType: "ferrite", collectedKg: 5, remainingKg: 175 });
  expect(quantities).toEqual([5]);
});

test("module and inventory routes proxy backend handlers", async () => {
  const app = createApp({
    listModules: async () => [
      {
        id: "module-1",
        blueprintId: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: { status: "active" },
        capabilities: [],
        source: "local",
      },
    ],
    getModule: async () => ({
      module: {
        id: "module-1",
        blueprintId: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: { status: "active" },
        capabilities: [],
        source: "local",
      },
      modules: [
        {
          id: "module-1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: { status: "active" },
          capabilities: [],
          source: "local",
        },
      ],
      blueprint: null,
    }),
    createModule: async () => ({
      id: "module-2",
      blueprintId: "life-support",
      displayName: "Life Support",
      connectedTo: [],
      runtimeAttributes: {},
      capabilities: [],
      source: "local",
    }),
    updateModule: async () => ({
      id: "module-1",
      blueprintId: "command-module",
      displayName: "Updated Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "idle" },
      capabilities: [],
      source: "local",
    }),
    deleteModule: async () => ({
      id: "module-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: [],
      source: "local",
    }),
    setModuleStatus: async () => ({
      module: {
        id: "module-1",
        blueprintId: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: { status: "offline" },
        capabilities: [],
        source: "local",
      },
      currentPowerDrawKw: 0,
    }),
    getModulePowerStatus: async () => ({
      rows: [
        {
          displayName: "Command Module",
          declaredStatus: "active",
          effectiveState: "active",
          currentPowerDrawKw: 0,
        },
      ],
      totalCurrentPowerDrawKw: 0,
      oneTickEnergyCostKwh: 0,
    }),
    listInventory: async () => [
      { resourceType: "ferrite", quantity: 90 },
    ],
    addInventoryResource: async (resourceType: string, quantity: number) => ({
      resourceType,
      quantity,
    }),
    removeInventoryResource: async (resourceType: string, quantity: number) => ({
      resourceType,
      quantity,
    }),
  });

  const moduleList = await app.request("/modules");
  expect(moduleList.status).toBe(200);
  expect(await moduleList.json()).toEqual([
    {
      id: "module-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: [],
      source: "local",
    },
  ]);

  const moduleShow = await app.request("/modules/module-1");
  expect(moduleShow.status).toBe(200);
  expect(await moduleShow.json()).toEqual({
    module: {
      id: "module-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: [],
      source: "local",
    },
    modules: [
      {
        id: "module-1",
        blueprintId: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: { status: "active" },
        capabilities: [],
        source: "local",
      },
    ],
    blueprint: null,
  });

  const inventory = await app.request("/inventory");
  expect(inventory.status).toBe(200);
  expect(await inventory.json()).toEqual([
    { resourceType: "ferrite", quantity: 90 },
  ]);
});

test("GET /humans returns the stored humans as json", async () => {
  const app = createApp({
    listHumans: async () => ([
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
    ]),
  });

  const response = await app.request("/humans");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
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
  ]);
});

test("human routes proxy backend handlers", async () => {
  const app = createApp({
    listHumans: async () => ([
      {
        id: "human-1",
        displayName: "Crew Member 1",
        locationModuleId: "module-command-1",
      },
    ]),
    moveHuman: async (humanId: string, moduleId: string) => ({
      id: humanId,
      displayName: "Crew Member 1",
      locationModuleId: moduleId,
    }),
  });

  const moved = await app.request("/humans/human-1/location", {
    method: "PUT",
    body: JSON.stringify({ moduleId: "module-lab-1" }),
    headers: { "content-type": "application/json" },
  });

  expect(moved.status).toBe(200);
  expect(await moved.json()).toEqual({
    id: "human-1",
    displayName: "Crew Member 1",
    locationModuleId: "module-lab-1",
  });
});

test("GET / serves the dashboard shell when a static asset directory is configured", async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "habitat-dashboard-"));

  try {
    writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>");

    const app = createApp({ staticAssetDir: staticDir });
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<div id=\"root\"></div>");
  } finally {
    rmSync(staticDir, { recursive: true, force: true });
  }
});

test("GET /registration still returns JSON when static assets are enabled", async () => {
  const staticDir = mkdtempSync(path.join(os.tmpdir(), "habitat-dashboard-"));

  try {
    writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>");

    const app = createApp({
      staticAssetDir: staticDir,
      readRegistration: () => ({
        habitatUuid: "uuid-123",
        habitatId: "habitat-123",
        displayName: "Starlight Forge",
        apiToken: "token-abc",
        moduleCount: 2,
      }),
    });

    const response = await app.request("/registration");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      registration: {
        habitatUuid: "uuid-123",
        habitatId: "habitat-123",
        displayName: "Starlight Forge",
        moduleCount: 2,
      },
    });
  } finally {
    rmSync(staticDir, { recursive: true, force: true });
  }
});
