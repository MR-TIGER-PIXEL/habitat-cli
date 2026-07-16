import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { StarterHuman } from "../kepler";
import {
  readClockState,
  hydrateRegistrationState,
  readAlertContract,
  readCurrentTick,
  readHumans,
  readModules,
  readRegistration,
  setCurrentTick,
  writeRegistration,
} from "./registration-store";

test("writeRegistration updates a legacy registration row that still has a required base_url column", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));
  const habitatDirectory = path.join(cwd, ".habitat");
  const databasePath = path.join(habitatDirectory, "habitat.sqlite");

  try {
    mkdirSync(habitatDirectory, { recursive: true });
    const database = new Database(databasePath, { create: true });
    database.exec(`
      CREATE TABLE registration (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL,
        habitat_uuid TEXT NOT NULL,
        habitat_id TEXT NOT NULL,
        base_url TEXT NOT NULL
      );
    `);
    database
      .query(
        `INSERT INTO registration (id, display_name, habitat_uuid, habitat_id, base_url)
         VALUES (1, ?, ?, ?, ?)`,
      )
      .run(
        "Artemis Ridge",
        "uuid-old",
        "habitat-old",
        "https://planet.turingguild.com",
      );
    database.close();

    writeRegistration(cwd, {
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-old",
      habitatId: "habitat-new",
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
      moduleCount: 6,
    });

    expect(readRegistration(cwd)).toEqual({
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-old",
      habitatId: "habitat-new",
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
      moduleCount: 6,
    });

    const migratedDatabase = new Database(databasePath, { create: true });
    const columns = migratedDatabase.query<{ name: string }, []>("PRAGMA table_info(registration)").all();
    expect(columns.map((column) => column.name)).toContain("stream_url");
    expect(columns.map((column) => column.name)).toContain("stream_metadata_json");
    const stored = migratedDatabase.query<{
      apiToken: string;
      streamUrl: string | null;
      streamMetadataJson: string | null;
    }, []>(
      "SELECT api_token AS apiToken, stream_url AS streamUrl, stream_metadata_json AS streamMetadataJson FROM registration WHERE id = 1",
    ).get();
    expect(stored?.apiToken).toBe("kepler-stream-token");
    expect(stored?.streamUrl).toBe("wss://planet.turingguild.com/planet/stream");
    expect(JSON.parse(stored?.streamMetadataJson ?? "{}")).toEqual({
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "paused",
    });
    expect(migratedDatabase.query<{ count: number }, []>(
      "SELECT COUNT(*) AS count FROM pragma_table_info('clock_state') WHERE name = 'api_token'",
    ).get()?.count).toBe(0);
    migratedDatabase.close();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("writeRegistration preserves the existing current tick", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    writeRegistration(cwd, {
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-1",
      habitatId: "habitat-1",
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
      moduleCount: 6,
    });
    setCurrentTick(cwd, 120);

    writeRegistration(cwd, {
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-1",
      habitatId: "habitat-2",
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 1,
        tickIntervalMs: 1000,
        ticksPerPulse: 1,
        status: "running",
      },
      moduleCount: 6,
    });

    expect(readCurrentTick(cwd)).toBe(120);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("hydrateRegistrationState persists registration, modules, and humans together", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    hydrateRegistrationState(cwd, {
      registration: {
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-1",
        habitatId: "habitat-1",
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
      },
      alertContract: {
        schemaVersion: "1.0",
        schema: {
          type: "object",
          required: ["kind", "severity", "status"],
        },
      },
      modules: [
        {
          id: "module-command-1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: { status: "active" },
          capabilities: ["habitat-command"],
          source: "registration",
        },
        {
          id: "module-suitport-1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: ["module-command-1"],
          runtimeAttributes: { status: "idle" },
          capabilities: ["basic-suitport"],
          source: "registration",
        },
      ],
      humans: [
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
      ],
    });

    expect(readRegistration(cwd)?.habitatId).toBe("habitat-1");
    expect(readRegistration(cwd)?.apiToken).toBe("kepler-stream-token");
    expect(readRegistration(cwd)?.streamUrl).toBe("wss://planet.turingguild.com/planet/stream");
    expect(readAlertContract(cwd)).toEqual({
      schemaVersion: "1.0",
      schema: {
        type: "object",
        required: ["kind", "severity", "status"],
      },
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
        locationModuleId: "module-suitport-1",
      },
    ] satisfies StarterHuman[]);
    expect(readClockState(cwd)).toEqual({
      mode: "manual",
      connectionState: "disconnected",
      latestAbsoluteKeplerTick: null,
      latestAdvancedBy: null,
      lastConnectedAt: null,
      lastMessageAt: null,
      lastDisconnectedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("hydrateRegistrationState rolls back the entire registration when human persistence fails", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    expect(() =>
      hydrateRegistrationState(cwd, {
        registration: {
          displayName: "Artemis Ridge",
          habitatUuid: "uuid-1",
          habitatId: "habitat-1",
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
        },
        alertContract: {
          schemaVersion: "1.0",
          schema: {
            type: "object",
            required: ["kind", "severity", "status"],
          },
        },
        modules: [
          {
            id: "module-command-1",
            blueprintId: "command-module",
            displayName: "Command Module",
            connectedTo: [],
            runtimeAttributes: { status: "active" },
            capabilities: ["habitat-command"],
            source: "registration",
          },
          {
            id: "module-suitport-1",
            blueprintId: "basic-suitport",
            displayName: "Basic Suitport",
            connectedTo: ["module-command-1"],
            runtimeAttributes: { status: "idle" },
            capabilities: ["basic-suitport"],
            source: "registration",
          },
        ],
        humans: [
          {
            id: "human-1",
            displayName: "Crew Member 1",
            locationModuleId: "module-command-1",
          },
          {
            id: "human-1",
            displayName: "Broken Human",
            locationModuleId: "module-suitport-1",
          },
        ],
      }),
    ).toThrow();

    expect(readRegistration(cwd)).toBeNull();
    expect(readAlertContract(cwd)).toBeNull();
    expect(readModules(cwd)).toEqual([]);
    expect(readHumans(cwd)).toEqual([]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("readRegistration treats missing stream credentials as incomplete legacy state", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    writeRegistration(cwd, {
      displayName: "Legacy Habitat",
      habitatUuid: "uuid-legacy",
      habitatId: "habitat-legacy",
      apiToken: "",
      streamUrl: "",
      stream: {
        protocolVersion: "",
        subscriptions: [],
        currentTick: 0,
        tickIntervalMs: 0,
        ticksPerPulse: 0,
        status: "paused",
      },
      moduleCount: 1,
    });

    expect(readRegistration(cwd)?.apiToken).toBe("");
    expect(readRegistration(cwd)?.streamUrl).toBeNull();
    expect(readRegistration(cwd)?.stream).toBeNull();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("stream metadata without tickIntervalMs is accepted", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    writeRegistration(cwd, {
      displayName: "Optional Tick Interval Habitat",
      habitatUuid: "uuid-optional",
      habitatId: "habitat-optional",
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks", "alerts"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "paused",
      },
      moduleCount: 1,
    });

    expect(readRegistration(cwd)?.stream).toEqual({
      protocolVersion: "1.0",
      subscriptions: ["ticks", "alerts"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "paused",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("stream metadata with tickIntervalMs is preserved", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    writeRegistration(cwd, {
      displayName: "Tick Interval Habitat",
      habitatUuid: "uuid-tick-interval",
      habitatId: "habitat-tick-interval",
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 7,
        tickIntervalMs: 1000,
        ticksPerPulse: 2,
        status: "running",
      },
      moduleCount: 1,
    });

    expect(readRegistration(cwd)?.stream).toEqual({
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 7,
      tickIntervalMs: 1000,
      ticksPerPulse: 2,
      status: "running",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("currentTick zero and subscriptions round-trip correctly", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    writeRegistration(cwd, {
      displayName: "Round Trip Habitat",
      habitatUuid: "uuid-round-trip",
      habitatId: "habitat-round-trip",
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks", "alerts", "world"],
        currentTick: 0,
        ticksPerPulse: 3,
        status: "ready",
      },
      moduleCount: 1,
    });

    const registration = readRegistration(cwd);
    expect(registration?.stream?.currentTick).toBe(0);
    expect(registration?.stream?.subscriptions).toEqual(["ticks", "alerts", "world"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("malformed stream metadata is treated as incomplete", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-registration-store-"));

  try {
    writeRegistration(cwd, {
      displayName: "Malformed Metadata Habitat",
      habitatUuid: "uuid-malformed",
      habitatId: "habitat-malformed",
      apiToken: "kepler-stream-token",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "paused",
      },
      moduleCount: 1,
    });

    const databasePath = path.join(cwd, ".habitat", "habitat.sqlite");
    const database = new Database(databasePath, { create: true });
    database.query("UPDATE registration SET stream_metadata_json = ? WHERE id = 1").run("{not-json");
    database.close();

    expect(readRegistration(cwd)?.stream).toBeNull();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
