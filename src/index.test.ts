import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createModule,
  deleteModule,
  formatModuleListEntry,
  getRegistrationStatus,
  listModules,
  parseJsonArray,
  parseJsonObject,
  registerHabitat,
  resolveModuleReference,
  showModule,
  unregisterHabitat,
  updateModule,
  type CliConfig,
  type FetchLike,
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

function createRegistrationPayload() {
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

test("register stores registration, hydrated starter modules, and blueprint lookups", async () => {
  const cwd = createWorkspace();
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const payload = createRegistrationPayload();

  const fetchMock: FetchLike = async (url, init) => {
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
  };

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
  const fetchMock: FetchLike = async (url, init) => {
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
  };

  const result = await getRegistrationStatus(createConfig(cwd, fetchMock));

  expect(requests).toEqual([
    "GET https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111/registration",
  ]);
  expect(result.habitat.status).toBe("registered");
  expect(result.moduleCount).toBe(6);

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

  const config = createConfig(cwd, async () => new Response(null, { status: 200 }));

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
  const fetchMock: FetchLike = async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(null, { status: 204 });
  };

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
