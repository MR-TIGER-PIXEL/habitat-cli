import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { deployHuman, dockExplorer, getEvaStatus, moveExplorer } from "./eva-service";
import {
  readAlerts,
  readExplorationState,
  readHumans,
  readInventory,
  writeAlertContract,
  writeExplorationState,
  writeHumans,
  writeInventory,
  writeModules,
  writeRegistration,
} from "./registration-store";

function createCwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "habitat-eva-service-"));
}

function seedRegisteredEvaState(cwd: string) {
  writeRegistration(cwd, {
    habitatUuid: "uuid-1",
    habitatId: "habitat-1",
    displayName: "Artemis Ridge",
    apiToken: "local-token",
    moduleCount: 2,
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
      runtimeAttributes: { status: "active", crewCapacity: 1 },
      capabilities: ["limited-eva", "suitport-access"],
      source: "registration",
    },
    {
      id: "module-lab-1",
      blueprintId: "science-lab",
      displayName: "Science Lab",
      connectedTo: [],
      runtimeAttributes: { status: "offline", crewCapacity: 2 },
      capabilities: ["science"],
      source: "registration",
    },
  ]);
  writeHumans(cwd, [
    {
      id: "human-1",
      displayName: "Crew Member 1",
      locationModuleId: "module-suitport-1",
    },
    {
      id: "human-2",
      displayName: "Crew Member 2",
      locationModuleId: "module-lab-1",
    },
  ]);
}

test("getEvaStatus returns the default local exploration state when none has been saved yet", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredEvaState(cwd);

    expect(await getEvaStatus(cwd)).toEqual({
      deployedHumanId: null,
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("deployHuman deploys a human from the active Basic Suitport at (0, 0)", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredEvaState(cwd);

    expect(await deployHuman(cwd, "human-1")).toEqual({
      deployedHumanId: "human-1",
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });
    expect(readExplorationState(cwd).deployedHumanId).toBe("human-1");
    expect(readAlerts(cwd)).toEqual([
      expect.objectContaining({
        id: "alert:eva-deployed:human-1",
        type: "eva.deployed-outside-habitat",
        status: "open",
        occurrenceCount: 1,
        subjectHumanId: "human-1",
      }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("deployHuman rejects a human who is not in the active Basic Suitport without changing saved state", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredEvaState(cwd);
    const before = readExplorationState(cwd);

    await expect(deployHuman(cwd, "human-2")).rejects.toThrow(
      'Human "human-2" must currently be in active Basic Suitport module "module-suitport-1".',
    );
    expect(readExplorationState(cwd)).toEqual(before);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("moveExplorer persists a successful adjacent move inside the current Kepler sector", async () => {
  const cwd = createCwd();
  const originalFetch = globalThis.fetch;

  try {
    seedRegisteredEvaState(cwd);
    await deployHuman(cwd, "human-1");

    globalThis.fetch = Object.assign(async () =>
      new Response(JSON.stringify({
        sector: {
          id: "kepler-442b-local-001",
          displayName: "Kepler-442b Local Survey Grid",
          origin: { x: 0, y: 0 },
          bounds: {
            minX: -25,
            maxX: 24,
            minY: -25,
            maxY: 24,
          },
          tileSizeMeters: 100,
          supportedTerrains: ["flat"],
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }), { preconnect: () => {} }) as typeof fetch;

    process.env.KEPLER_BASE_URL = "https://kepler.test";
    process.env.KEPLER_PLANET_TOKEN = "test-token";

    expect(await moveExplorer(cwd, { x: 1, y: 0 })).toEqual({
      deployedHumanId: "human-1",
      x: 1,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });
    expect(readExplorationState(cwd).x).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("moveExplorer rejects diagonal, jump, and out-of-sector moves without changing saved state", async () => {
  const cwd = createCwd();
  const originalFetch = globalThis.fetch;

  try {
    seedRegisteredEvaState(cwd);
    await deployHuman(cwd, "human-1");
    process.env.KEPLER_BASE_URL = "https://kepler.test";
    process.env.KEPLER_PLANET_TOKEN = "test-token";

    globalThis.fetch = Object.assign(async () =>
      new Response(JSON.stringify({
        minX: -1,
        maxX: 1,
        minY: -1,
        maxY: 1,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }), { preconnect: () => {} }) as typeof fetch;

    const before = readExplorationState(cwd);

    await expect(moveExplorer(cwd, { x: 1, y: 1 })).rejects.toThrow(
      "Diagonal EVA moves are not allowed.",
    );
    expect(readExplorationState(cwd)).toEqual(before);

    await expect(moveExplorer(cwd, { x: 2, y: 0 })).rejects.toThrow(
      "EVA moves must be exactly one adjacent north, south, east, or west tile.",
    );
    expect(readExplorationState(cwd)).toEqual(before);

    await expect(moveExplorer(cwd, { x: -1, y: 0 })).resolves.toEqual({
      ...before,
      x: -1,
      y: 0,
    });
    await expect(moveExplorer(cwd, { x: -2, y: 0 })).rejects.toThrow(
      "Move to (-2, 0) is outside the current Kepler sector.",
    );
    expect(readExplorationState(cwd)).toEqual({
      ...before,
      x: -1,
      y: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dockExplorer clears the deployed human only when the explorer is at (0, 0)", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredEvaState(cwd);
    await deployHuman(cwd, "human-1");
    writeExplorationState(cwd, {
      deployedHumanId: "human-1",
      x: 1,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });

    await expect(dockExplorer(cwd)).rejects.toThrow("Docking is only allowed at (0, 0).");
    expect(readExplorationState(cwd).deployedHumanId).toBe("human-1");

    writeExplorationState(cwd, {
      deployedHumanId: "human-1",
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });

    expect(await dockExplorer(cwd)).toEqual({
      deployedHumanId: null,
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });
    expect(readAlerts(cwd)).toEqual([
      expect.objectContaining({
        id: "alert:eva-deployed:human-1",
        status: "resolved",
      }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dockExplorer transfers carried resources into local inventory, returns the human to the suitport, and clears exploration state", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredEvaState(cwd);
    writeInventory(cwd, { ferrite: 4, ice: 1 });
    writeHumans(cwd, [
      {
        id: "human-1",
        displayName: "Crew Member 1",
        locationModuleId: "module-lab-1",
      },
      {
        id: "human-2",
        displayName: "Crew Member 2",
        locationModuleId: "module-lab-1",
      },
    ]);
    writeExplorationState(cwd, {
      deployedHumanId: "human-1",
      x: 0,
      y: 0,
      carriedResources: {
        ferrite: 3,
        ice: 2,
        regolith: 5,
      },
      maxCarryingCapacityKg: 20,
    });

    expect(await dockExplorer(cwd)).toEqual({
      deployedHumanId: null,
      x: 0,
      y: 0,
      carriedResources: {},
      maxCarryingCapacityKg: 20,
    });
    expect(readInventory(cwd)).toEqual({
      ferrite: 7,
      ice: 3,
      regolith: 5,
    });
    expect(readHumans(cwd)).toEqual([
      {
        id: "human-1",
        displayName: "Crew Member 1",
        locationModuleId: "module-suitport-1",
      },
      {
        id: "human-2",
        displayName: "Crew Member 2",
        locationModuleId: "module-lab-1",
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dockExplorer rolls back the entire transaction when the deployed human record is missing", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredEvaState(cwd);
    writeInventory(cwd, { ferrite: 4 });
    writeHumans(cwd, [
      {
        id: "human-2",
        displayName: "Crew Member 2",
        locationModuleId: "module-lab-1",
      },
    ]);
    writeExplorationState(cwd, {
      deployedHumanId: "human-1",
      x: 0,
      y: 0,
      carriedResources: {
        ferrite: 3,
        regolith: 5,
      },
      maxCarryingCapacityKg: 20,
    });

    const inventoryBefore = readInventory(cwd);
    const humansBefore = readHumans(cwd);
    const explorationBefore = readExplorationState(cwd);

    await expect(dockExplorer(cwd)).rejects.toThrow('Human "human-1" not found.');
    expect(readInventory(cwd)).toEqual(inventoryBefore);
    expect(readHumans(cwd)).toEqual(humansBefore);
    expect(readExplorationState(cwd)).toEqual(explorationBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
