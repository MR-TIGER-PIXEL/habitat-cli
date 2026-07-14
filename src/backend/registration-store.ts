import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { LocalHabitatModule } from "../kepler";

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
  database.query("DELETE FROM tick_state WHERE id = 1").run();
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
