import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import {
  type AlertContract,
  type HabitatAlert,
  type ExplorationState,
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
  moduleCount: number;
};

export type BackendStatus = {
  currentTick: number;
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
      module_count INTEGER NOT NULL
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
}

export function readRegistration(cwd: string): BackendRegistration | null {
  const database = openDatabase(cwd);
  const row = database
    .query<{
      habitatUuid: string;
      habitatId: string;
      displayName: string;
      apiToken: string;
      moduleCount: number;
    }, []>(
      "SELECT habitat_uuid AS habitatUuid, habitat_id AS habitatId, display_name AS displayName, api_token AS apiToken, module_count AS moduleCount FROM registration WHERE id = 1",
    )
    .get();

  return row ?? null;
}

export function writeRegistration(cwd: string, registration: BackendRegistration): void {
  ensureBackendDirectory(cwd);
  const database = openDatabase(cwd);
  if (registrationTableHasBaseUrl(database)) {
    const existingBaseUrl = readLegacyBaseUrl(database);
    database
      .query(
        `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, base_url, api_token, module_count)
         VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           habitat_uuid = excluded.habitat_uuid,
           habitat_id = excluded.habitat_id,
           display_name = excluded.display_name,
           base_url = excluded.base_url,
           api_token = excluded.api_token,
           module_count = excluded.module_count`,
      )
      .run(
        registration.habitatUuid,
        registration.habitatId,
        registration.displayName,
        existingBaseUrl,
        registration.apiToken,
        registration.moduleCount,
      );
  } else {
    database
      .query(
        `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, api_token, module_count)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           habitat_uuid = excluded.habitat_uuid,
           habitat_id = excluded.habitat_id,
           display_name = excluded.display_name,
           api_token = excluded.api_token,
           module_count = excluded.module_count`,
      )
      .run(
        registration.habitatUuid,
        registration.habitatId,
        registration.displayName,
        registration.apiToken,
        registration.moduleCount,
      );
  }
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
          `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, base_url, api_token, module_count)
           VALUES (1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             habitat_uuid = excluded.habitat_uuid,
             habitat_id = excluded.habitat_id,
             display_name = excluded.display_name,
             base_url = excluded.base_url,
             api_token = excluded.api_token,
             module_count = excluded.module_count`,
        )
        .run(
          payload.registration.habitatUuid,
          payload.registration.habitatId,
          payload.registration.displayName,
          existingBaseUrl,
          payload.registration.apiToken,
          payload.registration.moduleCount,
        );
    } else {
      database
        .query(
          `INSERT INTO registration (id, habitat_uuid, habitat_id, display_name, api_token, module_count)
           VALUES (1, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             habitat_uuid = excluded.habitat_uuid,
             habitat_id = excluded.habitat_id,
             display_name = excluded.display_name,
             api_token = excluded.api_token,
             module_count = excluded.module_count`,
        )
        .run(
          payload.registration.habitatUuid,
          payload.registration.habitatId,
          payload.registration.displayName,
          payload.registration.apiToken,
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
