import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { deleteModule } from "./habitat-service";
import { moveHuman } from "./human-service";
import { readHumans, writeHumans, writeModules, writeRegistration } from "./registration-store";

function createCwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "habitat-human-service-"));
}

function seedRegisteredState(cwd: string) {
  writeRegistration(cwd, {
    habitatUuid: "uuid-1",
    habitatId: "habitat-1",
    displayName: "Artemis Ridge",
    apiToken: "local-token",
    streamUrl: null,
    stream: null,
    moduleCount: 3,
  });
  writeModules(cwd, [
    {
      id: "module-command-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active", crewCapacity: 2 },
      capabilities: ["habitat-command"],
      source: "registration",
    },
    {
      id: "module-lab-1",
      blueprintId: "science-lab",
      displayName: "Science Lab",
      connectedTo: [],
      runtimeAttributes: { status: "offline", crewCapacity: 1 },
      capabilities: ["science"],
      source: "local",
    },
    {
      id: "module-storage-1",
      blueprintId: "storage-module",
      displayName: "Storage",
      connectedTo: [],
      runtimeAttributes: { status: "idle", crewCapacity: 0 },
      capabilities: ["storage"],
      source: "local",
    },
  ]);
  writeHumans(cwd, [
    {
      id: "human-1",
      displayName: "Crew Member 1",
      locationModuleId: "module-command-1",
    },
    {
      id: "human-2",
      displayName: "Crew Member 2",
      locationModuleId: "module-command-1",
    },
  ]);
}

test("moveHuman updates the saved location when the destination module has available crewCapacity", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredState(cwd);

    const moved = await moveHuman(cwd, "human-1", "module-lab-1");

    expect(moved).toEqual({
      id: "human-1",
      displayName: "Crew Member 1",
      locationModuleId: "module-lab-1",
    });
    expect(readHumans(cwd)).toEqual([
      {
        id: "human-1",
        displayName: "Crew Member 1",
        locationModuleId: "module-lab-1",
      },
      {
        id: "human-2",
        displayName: "Crew Member 2",
        locationModuleId: "module-command-1",
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("moveHuman rejects a missing human without changing saved state", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredState(cwd);
    const humansBefore = readHumans(cwd);

    await expect(moveHuman(cwd, "missing-human", "module-lab-1")).rejects.toThrow(
      'Human "missing-human" not found.',
    );
    expect(readHumans(cwd)).toEqual(humansBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("moveHuman rejects a missing module without changing saved state", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredState(cwd);
    const humansBefore = readHumans(cwd);

    await expect(moveHuman(cwd, "human-1", "missing-module")).rejects.toThrow(
      'Module "missing-module" not found.',
    );
    expect(readHumans(cwd)).toEqual(humansBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("moveHuman rejects a full module without changing saved state", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredState(cwd);
    const humansBefore = readHumans(cwd);

    await expect(moveHuman(cwd, "human-1", "module-storage-1")).rejects.toThrow(
      'Module "module-storage-1" is already at crewCapacity.',
    );
    expect(readHumans(cwd)).toEqual(humansBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("deleteModule rejects an occupied module without changing saved state", async () => {
  const cwd = createCwd();

  try {
    seedRegisteredState(cwd);
    const humansBefore = readHumans(cwd);

    await expect(deleteModule(cwd, "module-command-1")).rejects.toThrow(
      'Module "module-command-1" cannot be deleted while occupied by a human.',
    );
    expect(readHumans(cwd)).toEqual(humansBefore);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
