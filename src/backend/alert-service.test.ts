import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import {
  acknowledgeAlert,
  listAlerts,
  observeCarryingCapacityAlert,
  observeCollectionFailureAlert,
  observeExplorerDeployedAlert,
  resolveCarryingCapacityAlert,
  resolveCollectionFailureAlert,
  resolveExplorerDeployedAlert,
} from "./alert-service";
import {
  readAlertContract,
  writeAlertContract,
  writeExplorationState,
  writeRegistration,
} from "./registration-store";

function createCwd(): string {
  return mkdtempSync(path.join(os.tmpdir(), "habitat-alert-service-"));
}

function seedAlertContext(cwd: string): void {
  writeRegistration(cwd, {
    habitatUuid: "uuid-1",
    habitatId: "habitat-1",
    displayName: "Artemis Ridge",
    apiToken: "local-token",
    streamUrl: null,
    stream: null,
    moduleCount: 2,
  });
  writeAlertContract(cwd, {
    schemaVersion: "1.0",
    schema: {
      type: "object",
      required: ["kind", "severity", "status"],
    },
  });
}

test("alert observations create one persistent alert and repeated unresolved observations increment occurrence count", async () => {
  const cwd = createCwd();

  try {
    seedAlertContext(cwd);

    const created = await observeExplorerDeployedAlert(cwd, {
      humanId: "human-1",
      now: "2026-07-15T10:00:00.000Z",
    });
    const repeated = await observeExplorerDeployedAlert(cwd, {
      humanId: "human-1",
      now: "2026-07-15T10:05:00.000Z",
    });

    expect(created?.id).toBe("alert:eva-deployed:human-1");
    expect(repeated?.id).toBe(created?.id);
    expect(readAlertContract(cwd)?.schemaVersion).toBe("1.0");
    expect(listAlerts(cwd)).toEqual([
      {
        id: "alert:eva-deployed:human-1",
        type: "eva.deployed-outside-habitat",
        contract: {
          schemaVersion: "1.0",
          schema: {
            type: "object",
            required: ["kind", "severity", "status"],
          },
        },
        severity: "warning",
        status: "open",
        source: "local.eva",
        createdAt: "2026-07-15T10:00:00.000Z",
        lastObservedAt: "2026-07-15T10:05:00.000Z",
        occurrenceCount: 2,
        subjectHumanId: "human-1",
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("alerts can be acknowledged and later resolved without creating duplicates", async () => {
  const cwd = createCwd();

  try {
    seedAlertContext(cwd);

    await observeCollectionFailureAlert(cwd, {
      humanId: "human-1",
      message: "There is not enough material remaining at this tile.",
      now: "2026-07-15T11:00:00.000Z",
    });
    const acknowledged = acknowledgeAlert(cwd, "alert:collection-failed:human-1", "2026-07-15T11:02:00.000Z");
    resolveCollectionFailureAlert(cwd, { humanId: "human-1", now: "2026-07-15T11:04:00.000Z" });

    expect(acknowledged.status).toBe("acknowledged");
    expect(listAlerts(cwd)).toEqual([
      {
        id: "alert:collection-failed:human-1",
        type: "eva.collection-failed",
        contract: {
          schemaVersion: "1.0",
          schema: {
            type: "object",
            required: ["kind", "severity", "status"],
          },
        },
        severity: "warning",
        status: "resolved",
        source: "local.collect",
        createdAt: "2026-07-15T11:00:00.000Z",
        lastObservedAt: "2026-07-15T11:04:00.000Z",
        occurrenceCount: 1,
        subjectHumanId: "human-1",
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("carrying-capacity alerts open at maximum capacity and resolve after the explorer is cleared", async () => {
  const cwd = createCwd();

  try {
    seedAlertContext(cwd);
    writeExplorationState(cwd, {
      deployedHumanId: "human-1",
      x: 0,
      y: 0,
      carriedResources: { ferrite: 20 },
      maxCarryingCapacityKg: 20,
      batteryPercent: 100,
      maxBatteryPercent: 100,
      batteryDrainPerTickPercent: 10,
      oxygenUnits: 80,
      maxOxygenUnits: 80,
      oxygenDrainPerTickUnits: 10,
    });

    await observeCarryingCapacityAlert(cwd, {
      humanId: "human-1",
      now: "2026-07-15T12:00:00.000Z",
    });
    resolveCarryingCapacityAlert(cwd, {
      humanId: "human-1",
      now: "2026-07-15T12:05:00.000Z",
    });
    resolveExplorerDeployedAlert(cwd, {
      humanId: "human-1",
      now: "2026-07-15T12:05:00.000Z",
    });

    expect(listAlerts(cwd)).toEqual([
      {
        id: "alert:eva-capacity:human-1",
        type: "eva.max-carrying-capacity",
        contract: {
          schemaVersion: "1.0",
          schema: {
            type: "object",
            required: ["kind", "severity", "status"],
          },
        },
        severity: "warning",
        status: "resolved",
        source: "local.collect",
        createdAt: "2026-07-15T12:00:00.000Z",
        lastObservedAt: "2026-07-15T12:05:00.000Z",
        occurrenceCount: 1,
        subjectHumanId: "human-1",
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
