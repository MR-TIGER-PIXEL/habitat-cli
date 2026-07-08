import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createModule,
  deleteModule,
  formatModuleListEntry,
  getOfficialBlueprint,
  getRegistrationStatus,
  listModules,
  listOfficialBlueprints,
  listOfficialResources,
  parseJsonArray,
  parseJsonObject,
  planConstruction,
  runPowerTicks,
  registerHabitat,
  resolveModuleReference,
  showModule,
  readTickState,
  unregisterHabitat,
  updateModule,
  type CliConfig,
  type FetchLike,
  type StoredBlueprint,
} from "./kepler";

function createWorkspace(): string {
  const workspace = path.join(
    os.tmpdir(),
    `habitat-cli-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function createConfig(cwd: string, fetchImpl: FetchLike): CliConfig {
  return {
    baseUrl: "https://planet.turingguild.com",
    token: "test-token",
    cwd,
    fetchImpl,
  };
}

function createFetchMock(
  handler: (url: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => Promise<Response>,
): FetchLike {
  return Object.assign(handler, {
    preconnect: fetch.preconnect.bind(fetch),
  }) as FetchLike;
}

function runCli(cwd: string, ...args: string[]) {
  return runCliWithEnv(cwd, {}, ...args);
}

function runCliWithEnv(cwd: string, env: Record<string, string>, ...args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", path.join(process.cwd(), "habitat"), ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      KEPLER_PLANET_TOKEN: "test-token",
      KEPLER_BASE_URL: "https://planet.turingguild.com",
      ...env,
    },
  });
}

function runCliWithMockedFetch(
  cwd: string,
  fixtures: Record<string, { status: number; body: unknown }>,
  ...args: string[]
) {
  return Bun.spawnSync({
    cmd: [
      "bun",
      "--preload",
      path.join(process.cwd(), "src/test-cli-fetch-mock.ts"),
      path.join(process.cwd(), "habitat"),
      ...args,
    ],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      KEPLER_PLANET_TOKEN: "test-token",
      KEPLER_BASE_URL: "https://planet.turingguild.com",
      HABITAT_TEST_FETCH_FIXTURES: JSON.stringify(fixtures),
    },
  });
}

function createRegistrationPayload(): {
  habitatId: string;
  starterModules: Array<{
    id: string;
    blueprintId: string;
    displayName: string;
    connectedTo: string[];
    runtimeAttributes: Record<string, unknown>;
    capabilities: string[];
  }>;
  blueprints: StoredBlueprint[];
} {
  return {
    habitatId: "habitat_11111111_1111_4111_8111_111111111111",
    starterModules: [
      {
        id: "module-command-1",
        blueprintId: "command-module",
        displayName: "Command Module",
        connectedTo: ["module-life-support-1"],
        runtimeAttributes: { status: "active", health: 100 },
        capabilities: ["habitat-command"],
      },
      {
        id: "module-life-support-1",
        blueprintId: "life-support",
        displayName: "Life Support",
        connectedTo: ["module-command-1"],
        runtimeAttributes: { status: "active", health: 100 },
        capabilities: ["atmosphere-control"],
      },
      {
        id: "module-battery-1",
        blueprintId: "basic-battery",
        displayName: "Basic Battery",
        connectedTo: [],
        runtimeAttributes: { status: "offline", health: 100 },
        capabilities: ["power-storage"],
      },
      {
        id: "module-supply-cache-1",
        blueprintId: "supply-cache",
        displayName: "Supply Cache",
        connectedTo: [],
        runtimeAttributes: { status: "active", health: 100 },
        capabilities: ["storage"],
      },
      {
        id: "module-workshop-1",
        blueprintId: "workshop-fabricator",
        displayName: "Workshop Fabricator",
        connectedTo: [],
        runtimeAttributes: { status: "idle", health: 100 },
        capabilities: ["basic-fabrication"],
      },
      {
        id: "module-suitport-1",
        blueprintId: "basic-suitport",
        displayName: "Basic Suitport",
        connectedTo: [],
        runtimeAttributes: { status: "idle", health: 100 },
        capabilities: ["limited-eva"],
      },
    ],
    blueprints: [
      {
        id: "blueprint-command-module",
        blueprintId: "command-module",
        displayName: "Command Module Blueprint",
        description: "Starter command module",
        status: "published",
        output: { itemType: "module", quantity: 1 },
        inputs: {},
        buildTicks: 480,
        repeatable: false,
        runtimeAttributes: { status: "active", health: 100 },
        capabilities: ["habitat-command"],
      },
      {
        id: "blueprint-life-support",
        blueprintId: "life-support",
        displayName: "Life Support Blueprint",
        description: "Starter life support",
        status: "published",
        output: { itemType: "module", quantity: 1 },
        inputs: {},
        buildTicks: 300,
        repeatable: true,
        runtimeAttributes: { status: "active", health: 100 },
        capabilities: ["atmosphere-control"],
      },
    ],
  };
}

function createOfficialBlueprintPayload(): StoredBlueprint {
  return {
    id: "blueprint-survey-rover",
    blueprintId: "survey-rover",
    displayName: "Survey Rover",
    description: "Builds a compact rover for local site surveys.",
    status: "published",
    output: { itemType: "vehicle", vehicleType: "survey-rover", quantity: 1 },
    inputs: { aluminum: 12, electronics: 6, batteryCells: 4 },
    productionCost: { energyKwh: 18 },
    requiredFacility: { moduleType: "workshop-fabricator" },
    buildTicks: 240,
    prerequisites: ["rover-bay"],
    unlocks: ["survey-missions"],
    repeatable: true,
    level: 1,
    runtimeAttributes: { durability: 100 },
    capabilities: ["survey-sites"],
  };
}

function createConstructibleBlueprintPayload(): StoredBlueprint {
  return {
    id: "blueprint-small-solar-array",
    blueprintId: "small-solar-array",
    displayName: "Small Solar Array",
    description: "Adds a compact solar power unit to the habitat.",
    status: "published",
    output: { itemType: "module", blueprintId: "small-solar-array", quantity: 1 },
    inputs: { aluminum: 8, electronics: 2 },
    requiredFacility: { moduleType: "workshop-fabricator" },
    buildTicks: 120,
    prerequisites: ["command-module", "basic-fabrication"],
    repeatable: true,
    runtimeAttributes: { status: "online", health: 100 },
    capabilities: ["power-generation"],
  };
}

function createOfficialResourcePayload() {
  return {
    id: "resource-water-ice",
    resourceType: "water-ice",
    displayName: "Water Ice",
    kind: "volatile",
    rarity: "common",
    description: "Frozen water that can be processed into life support and fuel inputs.",
    unit: "kg",
  };
}

test("register stores registration, hydrated starter modules, and blueprint lookups", async () => {
  const cwd = createWorkspace();
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const payload = createRegistrationPayload();

  const fetchMock = createFetchMock(async (url, init) => {
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: requestBody,
    });

    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await registerHabitat(createConfig(cwd, fetchMock), "Starlight Forge");

  expect(result.registration.displayName).toBe("Starlight Forge");
  expect(result.modules).toHaveLength(6);
  expect(result.modules.map((module) => module.id)).toEqual(
    payload.starterModules.map((module) => module.id),
  );
  expect(result.modules.every((module) => module.source === "registration")).toBe(true);
  expect(Object.keys(result.blueprints)).toEqual(["command-module", "life-support"]);

  expect(requests).toEqual([
    {
      url: "https://planet.turingguild.com/habitats/register",
      method: "POST",
      body: {
        displayName: "Starlight Forge",
        habitatUuid: result.registration.habitatUuid,
      },
    },
  ]);

  const habitatDirectory = path.join(cwd, ".habitat");
  expect(existsSync(path.join(habitatDirectory, "registration.json"))).toBe(true);
  expect(existsSync(path.join(habitatDirectory, "modules.json"))).toBe(true);
  expect(existsSync(path.join(habitatDirectory, "blueprints.json"))).toBe(true);

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as Array<{ id: string }>;
  expect(storedModules).toHaveLength(6);
  expect(storedModules.map((module) => module.id)).toEqual(
    payload.starterModules.map((module) => module.id),
  );

  const storedBlueprints = JSON.parse(
    readFileSync(path.join(habitatDirectory, "blueprints.json"), "utf8"),
  ) as Record<string, { blueprintId: string }>;
  expect(Object.keys(storedBlueprints)).toEqual(["command-module", "life-support"]);
  expect(storedBlueprints["command-module"].blueprintId).toBe("command-module");

  rmSync(cwd, { recursive: true, force: true });
});

test("status includes remote habitat details and local module count", async () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(createRegistrationPayload().starterModules.map((module) => ({
      ...module,
      source: "registration",
    })), null, 2)}\n`,
  );

  const requests: string[] = [];
  const fetchMock = createFetchMock(async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(
      JSON.stringify({
        habitat: {
          id: "habitat_11111111_1111_4111_8111_111111111111",
          habitatSlug: "starlight-forge",
          displayName: "Starlight Forge",
          catalogVersion: "2026-07-07",
          status: "registered",
          lastSeenAt: "2026-07-07T12:00:00.000Z",
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });

  const result = await getRegistrationStatus(createConfig(cwd, fetchMock));

  expect(requests).toEqual([
    "GET https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111/registration",
  ]);
  expect(result.habitat.status).toBe("registered");
  expect(result.moduleCount).toBe(6);

  rmSync(cwd, { recursive: true, force: true });
});

test("listOfficialBlueprints reads the official Kepler blueprint catalog without touching local state", async () => {
  const cwd = createWorkspace();
  const requests: string[] = [];
  const blueprint = createOfficialBlueprintPayload();

  const fetchMock = createFetchMock(async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(
      JSON.stringify({
        catalogVersion: "2026-06-24",
        blueprints: [blueprint],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });

  const result = await listOfficialBlueprints(createConfig(cwd, fetchMock));

  expect(requests).toEqual(["GET https://planet.turingguild.com/catalog/blueprints"]);
  expect(result.catalogVersion).toBe("2026-06-24");
  expect(result.blueprints).toHaveLength(1);
  expect(result.blueprints[0]?.blueprintId).toBe("survey-rover");
  expect(existsSync(path.join(cwd, ".habitat"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});

test("getOfficialBlueprint returns one official blueprint and maps not found to a friendly error", async () => {
  const cwd = createWorkspace();
  const requests: string[] = [];
  const blueprint = createOfficialBlueprintPayload();

  const fetchMock = createFetchMock(async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);

    if (String(url).endsWith("/catalog/blueprints/survey-rover")) {
      return new Response(JSON.stringify({ blueprint }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        error: {
          code: "not_found",
          message: "No blueprint with that id exists.",
        },
      }),
      {
        status: 404,
        headers: { "content-type": "application/json" },
      },
    );
  });

  const config = createConfig(cwd, fetchMock);
  const found = await getOfficialBlueprint(config, "survey-rover");
  expect(found.blueprintId).toBe("survey-rover");

  await expect(getOfficialBlueprint(config, "missing-blueprint")).rejects.toThrow(
    'Blueprint "missing-blueprint" was not found in the Kepler catalog.',
  );

  expect(requests).toEqual([
    "GET https://planet.turingguild.com/catalog/blueprints/survey-rover",
    "GET https://planet.turingguild.com/catalog/blueprints/missing-blueprint",
  ]);
  expect(existsSync(path.join(cwd, ".habitat"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});

test("listOfficialResources reads the official Kepler resource catalog without touching local state", async () => {
  const cwd = createWorkspace();
  const requests: string[] = [];
  const resource = createOfficialResourcePayload();

  const fetchMock = createFetchMock(async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(
      JSON.stringify({
        catalogVersion: "2026-06-24",
        resources: [resource],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  });

  const result = await listOfficialResources(createConfig(cwd, fetchMock));

  expect(requests).toEqual(["GET https://planet.turingguild.com/catalog/resources"]);
  expect(result.catalogVersion).toBe("2026-06-24");
  expect(result.resources).toHaveLength(1);
  expect(result.resources[0]?.resourceType).toBe("water-ice");
  expect(existsSync(path.join(cwd, ".habitat"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});

test("module CRUD works against local hydrated module state", async () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "blueprints.json"),
    `${JSON.stringify(
      {
        "command-module": createRegistrationPayload().blueprints[0],
      },
      null,
      2,
    )}\n`,
  );

  const config = createConfig(cwd, createFetchMock(async () => new Response(null, { status: 200 })));

  const modules = listModules(config);
  expect(modules).toHaveLength(6);
  expect(formatModuleListEntry(modules[0], modules)).toContain("cm-1 | Command Module | command-module");
  expect(formatModuleListEntry(modules[1], modules)).toContain("ls-1 | Life Support | life-support");

  const resolvedByAlias = resolveModuleReference(config, "cm-1");
  expect(resolvedByAlias.id).toBe("module-command-1");

  const shownStarter = showModule(config, "module-command-1");
  expect(shownStarter.module.displayName).toBe("Command Module");
  expect(shownStarter.blueprint?.displayName).toBe("Command Module Blueprint");

  const created = createModule(config, {
    id: "demo-module-1",
    blueprintId: "storage-module",
    displayName: "Demo Storage",
    connectedTo: [],
    runtimeAttributes: { status: "idle", health: 100 },
    capabilities: ["bulk-storage"],
  });
  expect(created.source).toBe("local");
  expect(listModules(config)).toHaveLength(7);

  const updated = updateModule(config, "demo-module-1", {
    displayName: "Updated Demo Storage",
    capabilities: ["bulk-storage", "overflow-storage"],
  });
  expect(updated.displayName).toBe("Updated Demo Storage");
  expect(updated.capabilities).toEqual(["bulk-storage", "overflow-storage"]);

  const shownCreated = showModule(config, "demo-module-1");
  expect(shownCreated.blueprint).toBeNull();
  expect(resolveModuleReference(config, "sm-1").id).toBe("demo-module-1");

  const deleted = deleteModule(config, "demo-module-1");
  expect(deleted.id).toBe("demo-module-1");
  expect(listModules(config)).toHaveLength(6);

  rmSync(cwd, { recursive: true, force: true });
});

test("JSON option parsers reject malformed values", () => {
  expect(() => parseJsonArray("{", "connected-to")).toThrow("Invalid connected-to. Use valid JSON.");
  expect(() => parseJsonArray('{"bad":true}', "capabilities")).toThrow(
    "Invalid capabilities. Use a JSON array of strings.",
  );
  expect(() => parseJsonObject('["bad"]', "runtime-attributes")).toThrow(
    "Invalid runtime-attributes. Use a JSON object.",
  );
});

test("power-only ticks drain battery energy and advance currentTick", async () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[0].runtimeAttributes = {
    ...starterModules[0].runtimeAttributes,
    status: "maintenance",
    powerDrawKw: { offline: 0, idle: 2, active: 2, damaged: 2 },
  };
  starterModules[1].runtimeAttributes = {
    ...starterModules[1].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 5, active: 5, damaged: 5 },
  };
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    currentEnergyKwh: 500,
    energyStorageKwh: 500,
    powerDrawKw: { offline: 0, idle: 0, active: 0, damaged: 0 },
  };
  starterModules[3].runtimeAttributes = {
    ...starterModules[3].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 0.5, active: 0.5, damaged: 0 },
  };
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 1, active: 8, damaged: 1 },
  };
  starterModules[5].runtimeAttributes = {
    ...starterModules[5].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 0.5, active: 2, damaged: 0.5 },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runPowerTicks(
    createConfig(cwd, createFetchMock(async () => new Response(null, { status: 200 }))),
    1,
  );

  expect(result.startTick).toBe(0);
  expect(result.endTick).toBe(1);
  expect(result.totalEnergyUsedKwh).toBeCloseTo(7 / 3600, 8);
  expect(result.batteries).toHaveLength(1);
  expect(result.batteries[0]?.id).toBe("module-battery-1");
  expect(result.batteries[0]?.currentEnergyKwh).toBeCloseTo(500 - 7 / 3600, 8);
  expect(readTickState(cwd).currentTick).toBe(1);

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as Array<{ id: string; runtimeAttributes: { currentEnergyKwh?: number } }>;
  const battery = storedModules.find((module) => module.id === "module-battery-1");
  expect(battery?.runtimeAttributes.currentEnergyKwh).toBeCloseTo(500 - 7 / 3600, 8);

  rmSync(cwd, { recursive: true, force: true });
});

test("ticks reduce remaining build ticks for active construction jobs", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "online",
    currentEnergyKwh: 500,
    energyStorageKwh: 500,
    powerDrawKw: { offline: 0, idle: 0, online: 0, active: 0, damaged: 0 },
  };
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    powerDrawKw: { offline: 0, idle: 1, online: 1, active: 8, damaged: 1 },
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 180,
      remainingBuildTicks: 180,
      futureDisplayName: "Small Solar Array",
      futureRuntimeAttributes: { status: "online", health: 100 },
      futureCapabilities: ["power-generation"],
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  runPowerTicks(
    createConfig(cwd, createFetchMock(async () => new Response(null, { status: 200 }))),
    5,
  );

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as Array<{ id: string; runtimeAttributes: Record<string, unknown> }>;
  const workshop = storedModules.find((module) => module.id === "module-workshop-1");
  const constructionJob = workshop?.runtimeAttributes.constructionJob as Record<string, unknown>;

  expect(constructionJob.remainingBuildTicks).toBe(175);

  rmSync(cwd, { recursive: true, force: true });
});

test("tick completes construction jobs, creates the output module, and frees the fabricator", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "online",
    currentEnergyKwh: 500,
    energyStorageKwh: 500,
    powerDrawKw: { offline: 0, idle: 0, online: 0, active: 0, damaged: 0 },
  };
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    powerDrawKw: { offline: 0, idle: 1, online: 1, active: 8, damaged: 1 },
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 3,
      remainingBuildTicks: 2,
      futureDisplayName: "Small Solar Array",
      futureRuntimeAttributes: { status: "online", health: 100 },
      futureCapabilities: ["power-generation"],
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "tick", "--count", "2");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("constructionCompleted:");
  expect(result.stdout.toString()).toContain("module-small-solar-array-1");

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as Array<{
    id: string;
    blueprintId: string;
    displayName: string;
    runtimeAttributes: Record<string, unknown>;
    capabilities: string[];
    source: string;
  }>;

  const workshop = storedModules.find((module) => module.id === "module-workshop-1");
  expect(workshop?.runtimeAttributes.status).toBe("idle");
  expect("constructionJobId" in (workshop?.runtimeAttributes ?? {})).toBe(false);
  expect("constructionJob" in (workshop?.runtimeAttributes ?? {})).toBe(false);

  const completedModule = storedModules.find((module) => module.id === "module-small-solar-array-1");
  expect(completedModule).toEqual({
    id: "module-small-solar-array-1",
    blueprintId: "small-solar-array",
    displayName: "Small Solar Array",
    connectedTo: [],
    runtimeAttributes: { status: "online", health: 100 },
    capabilities: ["power-generation"],
    source: "local",
  });

  rmSync(cwd, { recursive: true, force: true });
});

test("planConstruction reports constructibility without mutating local state", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "online",
    currentEnergyKwh: 500,
    energyStorageKwh: 500,
  };

  const blueprints = {
    "small-solar-array": createConstructibleBlueprintPayload(),
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "blueprints.json"),
    `${JSON.stringify(blueprints, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "inventory.json"),
    `${JSON.stringify({ aluminum: 10, electronics: 5 }, null, 2)}\n`,
  );

  const modulesBefore = readFileSync(path.join(habitatDirectory, "modules.json"), "utf8");
  const inventoryBefore = readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8");

  const result = planConstruction(
    createConfig(cwd, createFetchMock(async () => new Response(null, { status: 200 }))),
    "small-solar-array",
  );

  expect(result.requiredFacility.exists).toBe(true);
  expect(result.fabricator.available).toBe(true);
  expect(result.supplyCache.online).toBe(true);
  expect(result.prerequisites.met).toBe(true);
  expect(result.inventory.sufficient).toBe(true);
  expect(result.wouldCreateModule.blueprintId).toBe("small-solar-array");
  expect(result.resourcesToSpend).toEqual({ aluminum: 8, electronics: 2 });
  expect(result.canStart).toBe(true);
  expect(readFileSync(path.join(habitatDirectory, "modules.json"), "utf8")).toBe(modulesBefore);
  expect(readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8")).toBe(inventoryBefore);

  rmSync(cwd, { recursive: true, force: true });
});

test("construct dry-run reports blocked requirements and exits without mutating state", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "offline",
    currentEnergyKwh: 0,
    energyStorageKwh: 500,
  };
  starterModules[3].runtimeAttributes = {
    ...starterModules[3].runtimeAttributes,
    status: "offline",
  };
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-1",
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "blueprints.json"),
    `${JSON.stringify({ "small-solar-array": createConstructibleBlueprintPayload() }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "inventory.json"),
    `${JSON.stringify({ aluminum: 3, electronics: 1 }, null, 2)}\n`,
  );

  const modulesBefore = readFileSync(path.join(habitatDirectory, "modules.json"), "utf8");
  const inventoryBefore = readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8");

  const result = runCli(cwd, "construct", "small-solar-array", "--dry-run");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("requiredFacilityExists: yes");
  expect(stdout).toContain("fabricatorAvailable: no");
  expect(stdout).toContain("supplyCacheOnline: no");
  expect(stdout).toContain("prerequisitesMet: yes");
  expect(stdout).toContain("inventorySufficient: no");
  expect(stdout).toContain("wouldCreateModule: Small Solar Array");
  expect(stdout).toContain('resourcesToSpend: {"aluminum":8,"electronics":2}');
  expect(stdout).toContain("canStart: no");
  expect(stdout).toContain("required construction facility is busy");
  expect(stdout).toContain("supply cache is offline");
  expect(stdout).toContain("inventory shortfall: aluminum need=8 have=3");
  expect(stdout).toContain("inventory shortfall: electronics need=2 have=1");
  expect(stdout).toContain("construction cannot start or advance until a usable battery or power source is online");
  expect(readFileSync(path.join(habitatDirectory, "modules.json"), "utf8")).toBe(modulesBefore);
  expect(readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8")).toBe(inventoryBefore);

  rmSync(cwd, { recursive: true, force: true });
});

test("construct starts a local construction job from the Kepler blueprint and spends inventory", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "online",
    currentEnergyKwh: 500,
    energyStorageKwh: 500,
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "inventory.json"),
    `${JSON.stringify({ aluminum: 10, electronics: 5 }, null, 2)}\n`,
  );

  const result = runCliWithMockedFetch(
    cwd,
    {
      "GET https://planet.turingguild.com/catalog/blueprints/small-solar-array": {
        status: 200,
        body: { blueprint: createConstructibleBlueprintPayload() },
      },
    },
    "construct",
    "small-solar-array",
  );

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain('Started construction for blueprint "small-solar-array".');
  expect(stdout).toContain("fabricatorId: module-workshop-1");
  expect(stdout).toContain("outputModuleId: module-small-solar-array-1");
  expect(stdout).toContain("buildTicks: 120");
  expect(stdout).toContain("remainingBuildTicks: 120");

  const storedInventory = JSON.parse(
    readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8"),
  ) as Record<string, number>;
  expect(storedInventory).toEqual({ aluminum: 2, electronics: 3 });

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as Array<{
    id: string;
    blueprintId: string;
    runtimeAttributes: Record<string, unknown>;
    capabilities: string[];
  }>;
  expect(storedModules).toHaveLength(6);
  expect(storedModules.some((module) => module.id === "module-small-solar-array-1")).toBe(false);

  const workshop = storedModules.find((module) => module.id === "module-workshop-1");
  expect(workshop?.runtimeAttributes.status).toBe("active");
  expect(workshop?.runtimeAttributes.constructionJobId).toBe("job-small-solar-array-1");
  expect(workshop?.runtimeAttributes.constructionJob).toEqual({
    id: "job-small-solar-array-1",
    blueprintId: "small-solar-array",
    outputModuleId: "module-small-solar-array-1",
    buildTicks: 120,
    remainingBuildTicks: 120,
    futureDisplayName: "Small Solar Array",
    futureRuntimeAttributes: { status: "online", health: 100 },
    futureCapabilities: ["power-generation"],
  });

  rmSync(cwd, { recursive: true, force: true });
});

test("construct leaves local state unchanged when fetched Kepler blueprint cannot start", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "offline",
    currentEnergyKwh: 0,
    energyStorageKwh: 500,
  };
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-existing",
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "inventory.json"),
    `${JSON.stringify({ aluminum: 10, electronics: 5 }, null, 2)}\n`,
  );

  const modulesBefore = readFileSync(path.join(habitatDirectory, "modules.json"), "utf8");
  const inventoryBefore = readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8");

  const result = runCliWithMockedFetch(
    cwd,
    {
      "GET https://planet.turingguild.com/catalog/blueprints/small-solar-array": {
        status: 200,
        body: { blueprint: createConstructibleBlueprintPayload() },
      },
    },
    "construct",
    "small-solar-array",
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("required construction facility is busy");
  expect(readFileSync(path.join(habitatDirectory, "modules.json"), "utf8")).toBe(modulesBefore);
  expect(readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8")).toBe(inventoryBefore);

  rmSync(cwd, { recursive: true, force: true });
});

test("inventory add stores local resource quantities without Kepler validation", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );

  const firstAdd = runCli(cwd, "inventory", "add", "ferrite", "90");
  const secondAdd = runCli(cwd, "inventory", "add", "silicate-glass", "45");
  const thirdAdd = runCli(cwd, "inventory", "add", "conductive-ore", "18");
  const fourthAdd = runCli(cwd, "inventory", "add", "ferrite", "10");

  expect(firstAdd.exitCode).toBe(0);
  expect(firstAdd.stdout.toString()).toContain('Added 90 of "ferrite" to local inventory.');
  expect(secondAdd.exitCode).toBe(0);
  expect(thirdAdd.exitCode).toBe(0);
  expect(fourthAdd.exitCode).toBe(0);

  const storedInventory = JSON.parse(
    readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8"),
  ) as Record<string, number>;
  expect(storedInventory).toEqual({
    ferrite: 100,
    "silicate-glass": 45,
    "conductive-ore": 18,
  });

  rmSync(cwd, { recursive: true, force: true });
});

test("inventory list prints the local habitat inventory", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "inventory.json"),
    `${JSON.stringify(
      {
        ferrite: 90,
        "silicate-glass": 45,
        "conductive-ore": 18,
      },
      null,
      2,
    )}\n`,
  );

  const result = runCli(cwd, "inventory", "list");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("Resource Type");
  expect(stdout).toContain("Quantity");
  expect(stdout).toContain("ferrite");
  expect(stdout).toContain("90");
  expect(stdout).toContain("silicate-glass");
  expect(stdout).toContain("45");
  expect(stdout).toContain("conductive-ore");
  expect(stdout).toContain("18");

  rmSync(cwd, { recursive: true, force: true });
});

test("construction status prints active local construction jobs", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 120,
      remainingBuildTicks: 75,
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "construction", "status");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("fabricator: wf-1 (module-workshop-1)");
  expect(stdout).toContain("blueprintId: small-solar-array");
  expect(stdout).toContain("outputModuleId: module-small-solar-array-1");
  expect(stdout).toContain("buildTicks: 120");
  expect(stdout).toContain("remainingTicks: 75");

  rmSync(cwd, { recursive: true, force: true });
});

test("construction status prints a friendly message when no active jobs exist", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(createRegistrationPayload().starterModules.map((module) => ({
      ...module,
      source: "registration",
    })), null, 2)}\n`,
  );

  const result = runCli(cwd, "construction", "status");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("No active construction jobs.");

  rmSync(cwd, { recursive: true, force: true });
});

test("construction cancel clears the stored job, frees the fabricator, and does not create the output module", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 180,
      remainingBuildTicks: 180,
      futureDisplayName: "Small Solar Array",
      futureRuntimeAttributes: { status: "online", health: 100 },
      futureCapabilities: ["power-generation"],
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "inventory.json"),
    `${JSON.stringify({ ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 }, null, 2)}\n`,
  );

  const inventoryBefore = readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8");

  const result = runCli(cwd, "construction", "cancel", "wf-1");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain('Canceled construction job on "wf-1".');

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as Array<{
    id: string;
    runtimeAttributes: Record<string, unknown>;
  }>;
  const workshop = storedModules.find((module) => module.id === "module-workshop-1");
  expect(workshop?.runtimeAttributes.status).toBe("idle");
  expect("constructionJobId" in (workshop?.runtimeAttributes ?? {})).toBe(false);
  expect("constructionJob" in (workshop?.runtimeAttributes ?? {})).toBe(false);
  expect(storedModules.some((module) => module.id === "module-small-solar-array-1")).toBe(false);
  expect(readFileSync(path.join(habitatDirectory, "inventory.json"), "utf8")).toBe(inventoryBefore);

  rmSync(cwd, { recursive: true, force: true });
});

test("construction cancel removes the job so construction status reports none", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 180,
      remainingBuildTicks: 180,
      futureDisplayName: "Small Solar Array",
      futureRuntimeAttributes: { status: "online", health: 100 },
      futureCapabilities: ["power-generation"],
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const cancelResult = runCli(cwd, "construction", "cancel", "module-workshop-1");
  const statusResult = runCli(cwd, "construction", "status");

  expect(cancelResult.exitCode).toBe(0);
  expect(statusResult.exitCode).toBe(0);
  expect(statusResult.stdout.toString()).toContain("No active construction jobs.");

  rmSync(cwd, { recursive: true, force: true });
});

test("construction cancel accepts the generated fabricator name workshop-fabricator-1", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 180,
      remainingBuildTicks: 180,
      futureDisplayName: "Small Solar Array",
      futureRuntimeAttributes: { status: "online", health: 100 },
      futureCapabilities: ["power-generation"],
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "construction", "cancel", "workshop-fabricator-1");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain('Canceled construction job on "wf-1".');

  rmSync(cwd, { recursive: true, force: true });
});

test("module show presents active construction job details clearly for generated fabricator names", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    status: "active",
    constructionJobId: "job-small-solar-array-1",
    constructionJob: {
      id: "job-small-solar-array-1",
      blueprintId: "small-solar-array",
      outputModuleId: "module-small-solar-array-1",
      buildTicks: 180,
      remainingBuildTicks: 120,
      futureDisplayName: "Small Solar Array",
      futureRuntimeAttributes: { status: "online", health: 100 },
      futureCapabilities: ["power-generation"],
    },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "module", "show", "workshop-fabricator-1");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("alias: wf-1");
  expect(stdout).toContain("declaredStatus: active");
  expect(stdout).toContain("effectiveState: busy");
  expect(stdout).toContain("activeConstructionJob:");
  expect(stdout).toContain("blueprintId: small-solar-array");
  expect(stdout).toContain("outputModuleId: module-small-solar-array-1");
  expect(stdout).toContain("buildTicks: 180");
  expect(stdout).toContain("remainingTicks: 120");

  rmSync(cwd, { recursive: true, force: true });
});

test("module show presents battery details clearly for generated battery names", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    status: "online",
    currentEnergyKwh: 420,
    energyStorageKwh: 500,
    reserveKwh: 75,
    maxPowerOutputKw: 30,
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "module", "show", "basic-battery-1");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("alias: bb-1");
  expect(stdout).toContain("declaredStatus: online");
  expect(stdout).toContain("effectiveState: online");
  expect(stdout).toContain("battery:");
  expect(stdout).toContain("currentEnergyKwh: 420");
  expect(stdout).toContain("energyStorageKwh: 500");
  expect(stdout).toContain("reserveKwh: 75");
  expect(stdout).toContain("maxPowerOutputKw: 30");

  rmSync(cwd, { recursive: true, force: true });
});

test("module show presents completed small solar array attributes clearly for generated names", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules.push({
    id: "module-small-solar-array-1",
    blueprintId: "small-solar-array",
    displayName: "Small Solar Array",
    connectedTo: [],
    runtimeAttributes: {
      status: "online",
      powerGenerationKw: 12,
      degradedStormGenerationKw: 4,
      maintenanceHoursPer100Ticks: 2,
      surfaceAreaM2: 24,
    },
    capabilities: ["power-generation"],
    source: "local",
  });

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "module", "show", "small-solar-array-1");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("alias: ssa-1");
  expect(stdout).toContain("capabilities: [\"power-generation\"]");
  expect(stdout).toContain("declaredStatus: online");
  expect(stdout).toContain("effectiveState: online");
  expect(stdout).toContain("powerGenerationKw: 12");
  expect(stdout).toContain("degradedStormGenerationKw: 4");
  expect(stdout).toContain("maintenanceHoursPer100Ticks: 2");
  expect(stdout).toContain("surfaceAreaM2: 24");

  rmSync(cwd, { recursive: true, force: true });
});

test("CLI help shows the tick command", () => {
  const cwd = createWorkspace();
  const result = runCli(cwd, "--help");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("tick");

  rmSync(cwd, { recursive: true, force: true });
});

test("blueprint list prints a concise table of official blueprints", async () => {
  const cwd = createWorkspace();
  const blueprint = createOfficialBlueprintPayload();
  const result = runCliWithMockedFetch(
    cwd,
    {
      "GET https://planet.turingguild.com/catalog/blueprints": {
        status: 200,
        body: {
          catalogVersion: "2026-06-24",
          blueprints: [blueprint],
        },
      },
    },
    "blueprint",
    "list",
  );

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("Blueprint ID");
  expect(stdout).toContain("Display Name");
  expect(stdout).toContain("survey-rover");
  expect(stdout).toContain("Survey Rover");
  expect(stdout).toContain("published");
  expect(stdout).toContain("240");
  expect(stdout).toContain("Blueprint ID  Display Name  Status     Build Ticks");
  expect(stdout).toContain("survey-rover  Survey Rover  published  240");
  expect(stdout).not.toContain("Blueprint ID | Display Name | Status | Build Ticks");
  expect(existsSync(path.join(cwd, ".habitat"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});

test("blueprint show prints readable details and reports missing blueprints cleanly", async () => {
  const cwd = createWorkspace();
  const blueprint = createOfficialBlueprintPayload();
  const fixtures = {
    "GET https://planet.turingguild.com/catalog/blueprints/survey-rover": {
      status: 200,
      body: { blueprint },
    },
    "GET https://planet.turingguild.com/catalog/blueprints/missing-blueprint": {
      status: 404,
      body: {
        error: {
          code: "not_found",
          message: "No blueprint with that id exists.",
        },
      },
    },
  };

  const shown = runCliWithMockedFetch(cwd, fixtures, "blueprint", "show", "survey-rover");
  const missing = runCliWithMockedFetch(
    cwd,
    fixtures,
    "blueprint",
    "show",
    "missing-blueprint",
  );

  expect(shown.exitCode).toBe(0);
  expect(shown.stdout.toString()).toContain("blueprintId: survey-rover");
  expect(shown.stdout.toString()).toContain("displayName: Survey Rover");
  expect(shown.stdout.toString()).toContain("status: published");
  expect(shown.stdout.toString()).toContain("buildTicks: 240");
  expect(shown.stdout.toString()).toContain("repeatable: yes");
  expect(shown.stdout.toString()).toContain("inputs:");
  expect(shown.stdout.toString()).toContain("output:");
  expect(shown.stdout.toString()).toContain("capabilities:");

  expect(missing.exitCode).toBe(1);
  expect(missing.stderr.toString()).toContain(
    'Blueprint "missing-blueprint" was not found in the Kepler catalog.',
  );
  expect(existsSync(path.join(cwd, ".habitat"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});

test("resource list prints official resource types and explains the catalog boundary", async () => {
  const cwd = createWorkspace();
  const resource = createOfficialResourcePayload();

  const result = runCliWithMockedFetch(
    cwd,
    {
      "GET https://planet.turingguild.com/catalog/resources": {
        status: 200,
        body: {
          catalogVersion: "2026-06-24",
          resources: [resource],
        },
      },
    },
    "resource",
    "list",
  );

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("Resource Type");
  expect(stdout).toContain("Display Name");
  expect(stdout).toContain("water-ice");
  expect(stdout).toContain("Water Ice");
  expect(stdout).toContain("volatile");
  expect(stdout).toContain("common");
  expect(stdout).toContain("kg");
  expect(stdout).toContain("Resource Type  Display Name  Kind      Rarity  Unit");
  expect(stdout).toContain("water-ice      Water Ice     volatile  common  kg");
  expect(stdout).not.toContain("Resource Type | Display Name | Kind | Rarity | Unit");
  expect(stdout).toContain("resource catalog: possible resource types in the Kepler world");
  expect(stdout).toContain(
    "local inventory: resources your habitat owns, handled later",
  );
  expect(stdout).toContain(
    "blueprint requirements: resources or modules needed to build something later",
  );
  expect(existsSync(path.join(cwd, ".habitat"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});

test("module status shows module states, current power draw, and summary totals", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[0].runtimeAttributes = {
    ...starterModules[0].runtimeAttributes,
    status: "maintenance",
    powerDrawKw: { offline: 0, idle: 2, active: 2, damaged: 2 },
  };
  starterModules[1].runtimeAttributes = {
    ...starterModules[1].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 5, active: 5, damaged: 5 },
  };
  starterModules[2].runtimeAttributes = {
    ...starterModules[2].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 0, active: 0, damaged: 0 },
  };
  starterModules[3].runtimeAttributes = {
    ...starterModules[3].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 0.5, active: 0.5, damaged: 0 },
  };
  starterModules[4].runtimeAttributes = {
    ...starterModules[4].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 1, active: 8, damaged: 1 },
  };
  starterModules[5].runtimeAttributes = {
    ...starterModules[5].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 0.5, active: 2, damaged: 0.5 },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "module", "status");

  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("Module Name");
  expect(stdout).toContain("Command Module");
  expect(stdout).toContain("offline");
  expect(stdout).toContain("0");
  expect(stdout).toContain("Life Support");
  expect(stdout).toContain("Basic Battery");
  expect(stdout).toContain("Declared Status");
  expect(stdout).toContain("Effective State");
  expect(stdout).toContain("Module Name          Declared Status  Effective State  Current Power Draw (kW)");
  expect(stdout).toContain("Command Module       maintenance      offline          0");
  expect(stdout).toContain("Life Support         active           active           5");
  expect(stdout).toContain("Basic Battery        offline          offline          0");
  expect(stdout).not.toContain("Module Name | Declared Status | Effective State | Current Power Draw (kW)");
  expect(stdout).toContain("totalCurrentPowerDrawKw: 7");
  expect(stdout).toContain("oneTickEnergyCostKwh: 0.0019444444444444444");

  rmSync(cwd, { recursive: true, force: true });
});

test("module set-status updates only the runtime status and reports current power draw", () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  const starterModules = createRegistrationPayload().starterModules.map((module) => ({
    ...module,
    source: "registration" as const,
  }));
  starterModules[0].runtimeAttributes = {
    ...starterModules[0].runtimeAttributes,
    powerDrawKw: { offline: 0, idle: 2, online: 1, active: 4, damaged: 0.5 },
  };

  writeFileSync(
    path.join(habitatDirectory, "registration.json"),
    `${JSON.stringify(
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(habitatDirectory, "modules.json"),
    `${JSON.stringify(starterModules, null, 2)}\n`,
  );

  const result = runCli(cwd, "module", "set-status", "cm-1", "idle");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain('Updated module "cm-1".');
  expect(result.stdout.toString()).toContain("status: idle");
  expect(result.stdout.toString()).toContain("currentPowerDrawKw: 2");

  const storedModules = JSON.parse(
    readFileSync(path.join(habitatDirectory, "modules.json"), "utf8"),
  ) as typeof starterModules;
  const updatedModule = storedModules.find((module) => module.id === "module-command-1");

  expect(updatedModule).toEqual({
    ...starterModules[0],
    runtimeAttributes: {
      ...starterModules[0].runtimeAttributes,
      status: "idle",
    },
  });

  rmSync(cwd, { recursive: true, force: true });
});

test("unregister removes registration, modules, and blueprints files", async () => {
  const cwd = createWorkspace();
  const habitatDirectory = path.join(cwd, ".habitat");
  mkdirSync(habitatDirectory, { recursive: true });

  for (const [fileName, contents] of [
    [
      "registration.json",
      {
        displayName: "Starlight Forge",
        habitatUuid: "11111111-1111-4111-8111-111111111111",
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        baseUrl: "https://planet.turingguild.com",
      },
    ],
    ["modules.json", createRegistrationPayload().starterModules],
    ["blueprints.json", { "command-module": createRegistrationPayload().blueprints[0] }],
  ] as const) {
    writeFileSync(path.join(habitatDirectory, fileName), `${JSON.stringify(contents, null, 2)}\n`);
  }

  const requests: string[] = [];
  const fetchMock = createFetchMock(async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(null, { status: 204 });
  });

  const result = await unregisterHabitat(createConfig(cwd, fetchMock));

  expect(requests).toEqual([
    "DELETE https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111",
  ]);
  expect(result.displayName).toBe("Starlight Forge");
  expect(existsSync(path.join(habitatDirectory, "registration.json"))).toBe(false);
  expect(existsSync(path.join(habitatDirectory, "modules.json"))).toBe(false);
  expect(existsSync(path.join(habitatDirectory, "blueprints.json"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});
