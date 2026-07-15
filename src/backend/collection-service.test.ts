import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { collectMaterial } from "./collection-service";
import { readAlerts, readExplorationState, writeAlertContract, writeExplorationState, writeRegistration } from "./registration-store";

function createCwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "habitat-collection-service-"));
}

function seedRegisteredExplorer(cwd: string, carriedResources: Record<string, number> = {}): void {
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
  writeExplorationState(cwd, {
    deployedHumanId: "human-1",
    x: 4,
    y: -2,
    carriedResources,
    maxCarryingCapacityKg: 20,
  });
}

test("collectMaterial sends the saved explorer position to Kepler and persists a successful collection", async () => {
  const cwd = createCwd();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string | null }> = [];

  try {
    seedRegisteredExplorer(cwd, { ferrite: 15 });
    process.env.KEPLER_BASE_URL = "https://kepler.test";
    process.env.KEPLER_PLANET_TOKEN = "test-token";
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: typeof init?.body === "string" ? init.body : null });
      return new Response(JSON.stringify({
        collection: {
          x: 4,
          y: -2,
          resourceType: "ferrite",
          unit: "kg",
          collectedKg: 5,
          remainingKg: 175,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }, { preconnect: () => {} }) as typeof fetch;

    await expect(collectMaterial(cwd, 5)).resolves.toEqual({
      resourceType: "ferrite",
      collectedKg: 5,
      remainingKg: 175,
    });
    expect(requests).toEqual([{
      url: "https://kepler.test/world/collect",
      body: JSON.stringify({ habitatId: "habitat-1", x: 4, y: -2, quantityKg: 5 }),
    }]);
    expect(readExplorationState(cwd).carriedResources).toEqual({ ferrite: 20 });
    expect(readAlerts(cwd)).toEqual([
      expect.objectContaining({
        id: "alert:eva-capacity:human-1",
        type: "eva.max-carrying-capacity",
        status: "open",
        occurrenceCount: 1,
      }),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectMaterial rejects local validation failures without changing exploration state", async () => {
  const cwd = createCwd();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    seedRegisteredExplorer(cwd, { ferrite: 18 });
    const before = readExplorationState(cwd);
    globalThis.fetch = Object.assign(async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    }, { preconnect: () => {} }) as typeof fetch;

    await expect(collectMaterial(cwd, 0)).rejects.toThrow("Collection quantity must be a positive whole number of kilograms.");
    await expect(collectMaterial(cwd, 1.5)).rejects.toThrow("Collection quantity must be a positive whole number of kilograms.");
    await expect(collectMaterial(cwd, 3)).rejects.toThrow("Collection would exceed the explorer's carrying capacity of 20 kg.");

    writeExplorationState(cwd, { ...before, deployedHumanId: null });
    await expect(collectMaterial(cwd, 1)).rejects.toThrow("No human is currently deployed.");

    expect(fetchCalled).toBe(false);
    expect(readExplorationState(cwd)).toEqual({ ...before, deployedHumanId: null });
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectMaterial preserves carried resources when Kepler rejects collection", async () => {
  const cwd = createCwd();
  const originalFetch = globalThis.fetch;

  try {
    seedRegisteredExplorer(cwd, { ferrite: 4 });
    const before = readExplorationState(cwd);
    process.env.KEPLER_BASE_URL = "https://kepler.test";
    process.env.KEPLER_PLANET_TOKEN = "test-token";
    globalThis.fetch = Object.assign(async () =>
      new Response(JSON.stringify({ error: { message: "There is not enough material remaining at this tile." } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }), { preconnect: () => {} }) as typeof fetch;

    await expect(collectMaterial(cwd, 5)).rejects.toThrow(
      "There is not enough material remaining at this tile.",
    );
    expect(readExplorationState(cwd)).toEqual(before);
    expect(readAlerts(cwd)).toEqual([
      expect.objectContaining({
        id: "alert:collection-failed:human-1",
        type: "eva.collection-failed",
        status: "open",
        occurrenceCount: 1,
      }),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("collectMaterial increments occurrence count for repeated rejected remote collection attempts", async () => {
  const cwd = createCwd();
  const originalFetch = globalThis.fetch;

  try {
    seedRegisteredExplorer(cwd, { ferrite: 4 });
    process.env.KEPLER_BASE_URL = "https://kepler.test";
    process.env.KEPLER_PLANET_TOKEN = "test-token";
    globalThis.fetch = Object.assign(async () =>
      new Response(JSON.stringify({ error: { message: "There is not enough material remaining at this tile." } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }), { preconnect: () => {} }) as typeof fetch;

    await expect(collectMaterial(cwd, 5)).rejects.toThrow();
    await expect(collectMaterial(cwd, 5)).rejects.toThrow();

    expect(readAlerts(cwd)).toEqual([
      expect.objectContaining({
        id: "alert:collection-failed:human-1",
        occurrenceCount: 2,
        status: "open",
      }),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.KEPLER_BASE_URL;
    delete process.env.KEPLER_PLANET_TOKEN;
    rmSync(cwd, { recursive: true, force: true });
  }
});
