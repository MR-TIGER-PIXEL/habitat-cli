import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import {
  type AlertContract,
  type HabitatAlert,
  type ExplorationState,
  type HabitatRegistrationStream,
  type LocalHabitatModule,
  type PowerTickResult,
  type StarterHuman,
} from "../kepler";
import { createDefaultEvaState, clearDeployedEvaState } from "./eva-state";

export type BackendRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  apiToken: string;
  streamUrl: string | null;
  stream: HabitatRegistrationStream | null;
  moduleCount: number;
};

export type BackendStatus = {
  currentTick: number;
};

export type ClockConnectionState = "connected" | "connecting" | "disconnected" | "error";

export type BackendClockState = {
  mode: "manual" | "kepler";
  connectionState: ClockConnectionState;
  latestAbsoluteKeplerTick: number | null;
  latestAdvancedBy: number | null;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  lastDisconnectedAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export type BackendInventoryEntry = {
  resourceType: string;
  quantity: number;
};

const BACKEND_DIRECTORY = ".habitat";
const BACKEND_DATABASE = "habitat.sqlite";

function getBackendDirectory(cwd: string): string {
  return path.join(cwd, BACKEND_DIRECTORY);
}

function getDatabasePath(cwd: string): string {
  return path.join(getBackendDirectory(cwd), BACKEND_DATABASE);
}

function ensureBackendDirectory(cwd: string): void {
  const directory = getBackendDirectory(cwd);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function openDatabase(cwd: string): Database {
  ensureBackendDirectory(cwd);
  const database = new Database(getDatabasePath(cwd));
  database.exec(`
    CREATE TABLE IF NOT EXISTS registration (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      habitat_uuid TEXT NOT NULL,
      habitat_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      api_token TEXT NOT NULL,
      stream_url TEXT,
      stream_metadata_json TEXT,
      module_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clock_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL,
      latest_absolute_kepler_tick INTEGER,
      latest_advanced_by INTEGER,
      connection_state TEXT NOT NULL,
      last_connected_at TEXT,
      last_message_at TEXT,
      last_disconnected_at TEXT,
      last_error_at TEXT,
      last_error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS tick_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_tick INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      module_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS humans (
      id TEXT PRIMARY KEY,
      human_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_contract (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      contract_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      alert_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exploration_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      resource_type TEXT PRIMARY KEY,
      quantity INTEGER NOT NULL
    );
  `);
  migrateRegistrationTable(database);
  ensureClockStateRow(database);
  return database;
}

function migrateRegistrationTable(database: Database): void {
  const columns = database.query<{ name: string }, []>("PRAGMA table_info(registration)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("api_token")) {
    database.exec("ALTER TABLE registration ADD COLUMN api_token TEXT NOT NULL DEFAULT ''");
  }

  if (!columnNames.has("module_count")) {
    database.exec("ALTER TABLE registration ADD COLUMN module_count INTEGER NOT NULL DEFAULT 0");
  }

  if (!columnNames.has("stream_url")) {
    database.exec("ALTER TABLE registration ADD COLUMN stream_url TEXT");
  }

  if (!columnNames.has("stream_metadata_json")) {
    database.exec("ALTER TABLE registration ADD COLUMN stream_metadata_json TEXT");
  }
}

function ensureClockStateRow(database: Database): void {
  database.query(
    `INSERT INTO clock_state (
      id,
      mode,
      latest_absolute_kepler_tick,
      latest_advanced_by,
      connection_state,
      last_connected_at,
      last_message_at,
      last_disconnected_at,
      last_error_at,
      last_error_message
    )
     VALUES (1, 'manual', NULL, NULL, 'disconnected', NULL, NULL, NULL, NULL, NULL)
     ON CONFLICT(id) DO NOTHING`,
  ).run();
}

export function readRegistration(cwd: string): BackendRegistration | null {
  const database = openDatabase(cwd);
  const row = database
    .query<{
      habitatUuid: string;
      habitatId: string;
      displayName: string;
      apiToken: string;
      streamUrl: string | null;
      streamMetadataJson: string | null;
      moduleCount: number;
    }, []>(
      `SELECT habitat_uuid AS habitatUuid,
              habitat_id AS habitatId,
              display_name AS displayName,
              api_token AS apiToken,
              stream_url AS streamUrl,
              stream_metadata_json AS streamMetadataJson,
              module_count AS moduleCount
       FROM registration WHERE id = 1`,
    )
    .get();

  if (!row) {
    return null;
  }

  return {
    habitatUuid: row.habitatUuid,
    habitatId: row.habitatId,
    displayName: row.displayName,
    apiToken: row.apiToken,
    streamUrl: isNonEmptyString(row.streamUrl) ? row.streamUrl : null,
    stream: parseStoredStreamMetadata(row.streamMetadataJson),
    moduleCount: row.moduleCount,
  };
}

export function writeRegistration(cwd: string, registration: BackendRegistration): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const streamUrl = normalizeStoredString(registration.streamUrl);
  const streamMetadataJson = serializeStreamMetadata(registration.stream);
  if (registrationTableHasBaseUrl(database)) {
    const existingBaseUrl = readLegacyBaseUrl(database);
    database
      .query(
        `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, base_url, api_token, stream_url, stream_metadata_json, module_count)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           habitat_uuid = excluded.habitat_uuid,
           habitat_id = excluded.habitat_id,
           display_name = excluded.display_name,
           base_url = excluded.base_url,
           api_token = excluded.api_token,
           stream_url = excluded.stream_url,
           stream_metadata_json = excluded.stream_metadata_json,
           module_count = excluded.module_count`,
      )
      .run(
        registration.habitatUuid,
        registration.habitatId,
        registration.displayName,
        existingBaseUrl,
        registration.apiToken,
        streamUrl,
        streamMetadataJson,
        registration.moduleCount,
      );
  } else {
    database
      .query(
        `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, api_token, stream_url, stream_metadata_json, module_count)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           habitat_uuid = excluded.habitat_uuid,
           habitat_id = excluded.habitat_id,
           display_name = excluded.display_name,
           api_token = excluded.api_token,
           stream_url = excluded.stream_url,
           stream_metadata_json = excluded.stream_metadata_json,
           module_count = excluded.module_count`,
      )
      .run(
        registration.habitatUuid,
        registration.habitatId,
        registration.displayName,
        registration.apiToken,
        streamUrl,
        streamMetadataJson,
        registration.moduleCount,
      );
  }
}

export function readClockState(cwd: string): BackendClockState {
  const database = openDatabase(cwd);
  const row = database.query<{
    mode: BackendClockState["mode"];
    connectionState: ClockConnectionState;
    latestAbsoluteKeplerTick: number | null;
    latestAdvancedBy: number | null;
    lastConnectedAt: string | null;
    lastMessageAt: string | null;
    lastDisconnectedAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
  }, []>(
    `SELECT mode AS mode,
            connection_state AS connectionState,
            latest_absolute_kepler_tick AS latestAbsoluteKeplerTick,
            latest_advanced_by AS latestAdvancedBy,
            last_connected_at AS lastConnectedAt,
            last_message_at AS lastMessageAt,
            last_disconnected_at AS lastDisconnectedAt,
            last_error_at AS lastErrorAt,
            last_error_message AS lastErrorMessage
     FROM clock_state WHERE id = 1`,
  ).get();

  return row ?? {
    mode: "manual",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

export function writeClockState(cwd: string, state: BackendClockState): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  database
    .query(
      `INSERT INTO clock_state (
        id,
        mode,
        latest_absolute_kepler_tick,
        latest_advanced_by,
        connection_state,
        last_connected_at,
        last_message_at,
        last_disconnected_at,
        last_error_at,
        last_error_message
      )
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         mode = excluded.mode,
         latest_absolute_kepler_tick = excluded.latest_absolute_kepler_tick,
         latest_advanced_by = excluded.latest_advanced_by,
         connection_state = excluded.connection_state,
         last_connected_at = excluded.last_connected_at,
         last_message_at = excluded.last_message_at,
         last_disconnected_at = excluded.last_disconnected_at,
         last_error_at = excluded.last_error_at,
         last_error_message = excluded.last_error_message`,
    )
    .run(
      state.mode,
      state.latestAbsoluteKeplerTick,
      state.latestAdvancedBy,
      state.connectionState,
      state.lastConnectedAt,
      state.lastMessageAt,
      state.lastDisconnectedAt,
      state.lastErrorAt,
      state.lastErrorMessage,
    );
}

export function deleteRegistration(cwd: string): void {
  const database = openDatabase(cwd);
  database.query("DELETE FROM registration WHERE id = 1").run();
  database.query("DELETE FROM alert_contract WHERE id = 1").run();
  database.query("DELETE FROM alerts").run();
  database.query("DELETE FROM tick_state WHERE id = 1").run();
  database.query("DELETE FROM exploration_state WHERE id = 1").run();
}

export function readCurrentTick(cwd: string): number {
  const database = openDatabase(cwd);
  const row = database.query<{ currentTick: number }, []>(
    "SELECT current_tick AS currentTick FROM tick_state WHERE id = 1",
  ).get();
  return row?.currentTick ?? 0;
}

export function setCurrentTick(cwd: string, currentTick: number): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  database
    .query(
      `INSERT INTO tick_state (id, current_tick)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET
         current_tick = excluded.current_tick`,
    )
    .run(currentTick);
}

export function readModules(cwd: string): LocalHabitatModule[] {
  const database = openDatabase(cwd);
  const rows = database.query<{ module_json: string }, []>(
    "SELECT module_json FROM modules ORDER BY rowid",
  ).all();
  return rows.map((row) => JSON.parse(row.module_json) as LocalHabitatModule);
}

export function readHumans(cwd: string): StarterHuman[] {
  const database = openDatabase(cwd);
  const rows = database.query<{ human_json: string }, []>(
    "SELECT human_json FROM humans ORDER BY rowid",
  ).all();
  return rows.map((row) => JSON.parse(row.human_json) as StarterHuman);
}

export function writeModules(cwd: string, modules: LocalHabitatModule[]): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((items: LocalHabitatModule[]) => {
    database.query("DELETE FROM modules").run();
    const insert = database.query("INSERT INTO modules (id, module_json) VALUES (?, ?)");
    for (const module of items) {
      insert.run(module.id, JSON.stringify(module));
    }
  });
  transaction(modules);
}

export function writeHumans(cwd: string, humans: StarterHuman[]): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((items: StarterHuman[]) => {
    database.query("DELETE FROM humans").run();
    const insert = database.query("INSERT INTO humans (id, human_json) VALUES (?, ?)");
    for (const human of items) {
      insert.run(human.id, JSON.stringify(human));
    }
  });
  transaction(humans);
}

export function readAlertContract(cwd: string): AlertContract | null {
  const database = openDatabase(cwd);
  const row = database.query<{ contract_json: string }, []>(
    "SELECT contract_json FROM alert_contract WHERE id = 1",
  ).get();

  if (!row) {
    return null;
  }

  return JSON.parse(row.contract_json) as AlertContract;
}

export function writeAlertContract(cwd: string, contract: AlertContract): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  database
    .query(
      `INSERT INTO alert_contract (id, contract_json)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET
         contract_json = excluded.contract_json`,
    )
    .run(JSON.stringify(contract));
}

export function readAlerts(cwd: string): HabitatAlert[] {
  const database = openDatabase(cwd);
  const rows = database.query<{ alert_json: string }, []>(
    "SELECT alert_json FROM alerts ORDER BY rowid",
  ).all();
  return rows.map((row) => JSON.parse(row.alert_json) as HabitatAlert);
}

export function writeAlerts(cwd: string, alerts: HabitatAlert[]): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((items: HabitatAlert[]) => {
    database.query("DELETE FROM alerts").run();
    const insert = database.query("INSERT INTO alerts (id, alert_json) VALUES (?, ?)");
    for (const alert of items) {
      insert.run(alert.id, JSON.stringify(alert));
    }
  });
  transaction(alerts);
}

export function createDefaultExplorationState(): ExplorationState {
  return createDefaultEvaState();
}

export function readExplorationState(cwd: string): ExplorationState {
  const database = openDatabase(cwd);
  const row = database.query<{ state_json: string }, []>(
    "SELECT state_json FROM exploration_state WHERE id = 1",
  ).get();

  if (!row) {
    return createDefaultExplorationState();
  }

  return {
    ...createDefaultExplorationState(),
    ...(JSON.parse(row.state_json) as Partial<ExplorationState>),
  };
}

export function writeExplorationState(cwd: string, state: ExplorationState): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  database
    .query(
      `INSERT INTO exploration_state (id, state_json)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET
         state_json = excluded.state_json`,
    )
    .run(JSON.stringify(state));
}

export function hydrateRegistrationState(
  cwd: string,
  input: {
    registration: BackendRegistration;
    alertContract: AlertContract;
    modules: LocalHabitatModule[];
    humans: StarterHuman[];
  },
): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((payload: typeof input) => {
    if (registrationTableHasBaseUrl(database)) {
      const existingBaseUrl = readLegacyBaseUrl(database);
      database
        .query(
          `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, base_url, api_token, stream_url, stream_metadata_json, module_count)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             habitat_uuid = excluded.habitat_uuid,
             habitat_id = excluded.habitat_id,
             display_name = excluded.display_name,
             base_url = excluded.base_url,
             api_token = excluded.api_token,
             stream_url = excluded.stream_url,
             stream_metadata_json = excluded.stream_metadata_json,
             module_count = excluded.module_count`,
        )
        .run(
          payload.registration.habitatUuid,
          payload.registration.habitatId,
          payload.registration.displayName,
          existingBaseUrl,
          payload.registration.apiToken,
          normalizeStoredString(payload.registration.streamUrl),
          serializeStreamMetadata(payload.registration.stream),
          payload.registration.moduleCount,
        );
    } else {
      database
        .query(
          `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, api_token, stream_url, stream_metadata_json, module_count)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             habitat_uuid = excluded.habitat_uuid,
             habitat_id = excluded.habitat_id,
             display_name = excluded.display_name,
             api_token = excluded.api_token,
             stream_url = excluded.stream_url,
             stream_metadata_json = excluded.stream_metadata_json,
             module_count = excluded.module_count`,
        )
        .run(
          payload.registration.habitatUuid,
          payload.registration.habitatId,
          payload.registration.displayName,
          payload.registration.apiToken,
          normalizeStoredString(payload.registration.streamUrl),
          serializeStreamMetadata(payload.registration.stream),
          payload.registration.moduleCount,
        );
    }

    database.query("DELETE FROM modules").run();
    const insertModule = database.query("INSERT INTO modules (id, module_json) VALUES (?, ?)");
    for (const module of payload.modules) {
      insertModule.run(module.id, JSON.stringify(module));
    }

    database.query("DELETE FROM humans").run();
    const insertHuman = database.query("INSERT INTO humans (id, human_json) VALUES (?, ?)");
    for (const human of payload.humans) {
      insertHuman.run(human.id, JSON.stringify(human));
    }

    database
      .query(
        `INSERT INTO alert_contract (id, contract_json)
         VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET
           contract_json = excluded.contract_json`,
      )
      .run(JSON.stringify(payload.alertContract));

    database.query("DELETE FROM alerts").run();

    database
      .query(
        `INSERT INTO exploration_state (id, state_json)
         VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json`,
      )
      .run(JSON.stringify(createDefaultExplorationState()));
  });
  transaction(input);
}

export function readInventory(cwd: string): Record<string, number> {
  const database = openDatabase(cwd);
  const rows = database.query<{ resource_type: string; quantity: number }, []>(
    "SELECT resource_type, quantity FROM inventory ORDER BY resource_type",
  ).all();
  return Object.fromEntries(rows.map((row) => [row.resource_type, row.quantity]));
}

export function writeInventory(cwd: string, inventory: Record<string, number>): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((items: Record<string, number>) => {
    database.query("DELETE FROM inventory").run();
    const insert = database.query("INSERT INTO inventory (resource_type, quantity) VALUES (?, ?)");
    for (const [resourceType, quantity] of Object.entries(items)) {
      insert.run(resourceType, quantity);
    }
  });
  transaction(inventory);
}

export function dockExplorerState(
  cwd: string,
  input: {
    deployedHumanId: string;
    suitportModuleId: string;
  },
): ExplorationState {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((payload: typeof input) => {
    const explorationRow = database.query<{ state_json: string }, []>(
      "SELECT state_json FROM exploration_state WHERE id = 1",
    ).get();
    const exploration = explorationRow
      ? JSON.parse(explorationRow.state_json) as ExplorationState
      : createDefaultExplorationState();

    const inventoryRows = database.query<{ resource_type: string; quantity: number }, []>(
      "SELECT resource_type, quantity FROM inventory ORDER BY resource_type",
    ).all();
    const nextInventory = Object.fromEntries(
      inventoryRows.map((row) => [row.resource_type, row.quantity]),
    ) as Record<string, number>;

    for (const [resourceType, quantity] of Object.entries(exploration.carriedResources)) {
      nextInventory[resourceType] = (nextInventory[resourceType] ?? 0) + quantity;
    }

    database.query("DELETE FROM inventory").run();
    const insertInventory = database.query(
      "INSERT INTO inventory (resource_type, quantity) VALUES (?, ?)",
    );
    for (const [resourceType, quantity] of Object.entries(nextInventory)) {
      insertInventory.run(resourceType, quantity);
    }

    const humanRows = database.query<{ human_json: string }, []>(
      "SELECT human_json FROM humans ORDER BY rowid",
    ).all();
    const humans = humanRows.map((row) => JSON.parse(row.human_json) as StarterHuman);
    const nextHumans = humans.map((human) =>
      human.id === payload.deployedHumanId
        ? { ...human, locationModuleId: payload.suitportModuleId }
        : human);
    if (!nextHumans.some((human) => human.id === payload.deployedHumanId)) {
      throw new Error(`Human "${payload.deployedHumanId}" not found.`);
    }

    database.query("DELETE FROM humans").run();
    const insertHuman = database.query("INSERT INTO humans (id, human_json) VALUES (?, ?)");
    for (const human of nextHumans) {
      insertHuman.run(human.id, JSON.stringify(human));
    }

    const nextState = clearDeployedEvaState(exploration);
    database
      .query(
        `INSERT INTO exploration_state (id, state_json)
         VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json`,
      )
      .run(JSON.stringify(nextState));

    return nextState;
  });

  return transaction(input);
}

export function persistTickStateSnapshot(
  cwd: string,
  input: {
    tick: Omit<PowerTickResult, "modules">;
    modules: LocalHabitatModule[];
    exploration: ExplorationState;
    alerts: HabitatAlert[];
    clockState?: BackendClockState;
  },
): Omit<PowerTickResult, "modules"> {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  const transaction = database.transaction((payload: typeof input) => {
    database.query("DELETE FROM modules").run();
    const insertModule = database.query("INSERT INTO modules (id, module_json) VALUES (?, ?)");
    for (const module of payload.modules) {
      insertModule.run(module.id, JSON.stringify(module));
    }

    database
      .query(
        `INSERT INTO tick_state (id, current_tick)
         VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET
           current_tick = excluded.current_tick`,
      )
      .run(payload.tick.endTick);

    database
      .query(
        `INSERT INTO exploration_state (id, state_json)
         VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json`,
      )
      .run(JSON.stringify(payload.exploration));

    database.query("DELETE FROM alerts").run();
    const insertAlert = database.query("INSERT INTO alerts (id, alert_json) VALUES (?, ?)");
    for (const alert of payload.alerts) {
      insertAlert.run(alert.id, JSON.stringify(alert));
    }

    if (payload.clockState) {
      database
        .query(
          `INSERT INTO clock_state (
            id,
            mode,
            latest_absolute_kepler_tick,
            latest_advanced_by,
            connection_state,
            last_connected_at,
            last_message_at,
            last_disconnected_at,
            last_error_at,
            last_error_message
          )
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             mode = excluded.mode,
             latest_absolute_kepler_tick = excluded.latest_absolute_kepler_tick,
             latest_advanced_by = excluded.latest_advanced_by,
             connection_state = excluded.connection_state,
             last_connected_at = excluded.last_connected_at,
             last_message_at = excluded.last_message_at,
             last_disconnected_at = excluded.last_disconnected_at,
             last_error_at = excluded.last_error_at,
             last_error_message = excluded.last_error_message`,
        )
        .run(
          payload.clockState.mode,
          payload.clockState.latestAbsoluteKeplerTick,
          payload.clockState.latestAdvancedBy,
          payload.clockState.connectionState,
          payload.clockState.lastConnectedAt,
          payload.clockState.lastMessageAt,
          payload.clockState.lastDisconnectedAt,
          payload.clockState.lastErrorAt,
          payload.clockState.lastErrorMessage,
        );
    }

    return payload.tick;
  });

  return transaction(input);
}

function registrationTableHasBaseUrl(database: Database): boolean {
  const columns = database.query<{ name: string }, []>("PRAGMA table_info(registration)").all();
  return columns.some((column) => column.name === "base_url");
}

function readLegacyBaseUrl(database: Database): string {
  const row = database.query<{ baseUrl: string }, []>(
    "SELECT base_url AS baseUrl FROM registration WHERE id = 1",
  ).get();
  return row?.baseUrl ?? "";
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeStoredString(value: string | null | undefined): string | null {
  return isNonEmptyString(value) ? value : null;
}

function parseStoredStreamMetadata(streamMetadataJson: string | null): HabitatRegistrationStream | null {
  if (!isNonEmptyString(streamMetadataJson)) {
    return null;
  }

  let parsed: Partial<HabitatRegistrationStream> & Record<string, unknown>;
  try {
    parsed = JSON.parse(streamMetadataJson) as Partial<HabitatRegistrationStream> & Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    !isNonEmptyString(parsed.protocolVersion)
    || !Array.isArray(parsed.subscriptions)
    || parsed.subscriptions.some((item) => typeof item !== "string")
    || !Number.isInteger(parsed.currentTick)
    || (parsed.currentTick ?? -1) < 0
    || !Number.isInteger(parsed.ticksPerPulse)
    || (parsed.ticksPerPulse ?? 0) <= 0
    || !isNonEmptyString(parsed.status)
  ) {
    return null;
  }

  const stream: HabitatRegistrationStream = {
    protocolVersion: parsed.protocolVersion,
    subscriptions: parsed.subscriptions,
    currentTick: parsed.currentTick as number,
    ticksPerPulse: parsed.ticksPerPulse as number,
    status: parsed.status,
  };

  if ("tickIntervalMs" in parsed && parsed.tickIntervalMs !== undefined) {
    if (!Number.isInteger(parsed.tickIntervalMs) || parsed.tickIntervalMs <= 0) {
      return null;
    }
    return {
      ...stream,
      tickIntervalMs: parsed.tickIntervalMs,
    };
  }

  return stream;
}

function serializeStreamMetadata(stream: HabitatRegistrationStream | null | undefined): string | null {
  if (!stream) {
    return null;
  }

  return JSON.stringify(stream);
}
