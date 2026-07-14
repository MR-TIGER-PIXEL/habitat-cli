import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readCurrentTick, readRegistration, setCurrentTick, writeRegistration } from "./registration-store";

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
      apiToken: "local-api-token",
      moduleCount: 6,
    });

    expect(readRegistration(cwd)).toEqual({
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-old",
      habitatId: "habitat-new",
      apiToken: "local-api-token",
      moduleCount: 6,
    });
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
      apiToken: "local-api-token",
      moduleCount: 6,
    });
    setCurrentTick(cwd, 120);

    writeRegistration(cwd, {
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-1",
      habitatId: "habitat-2",
      apiToken: "local-api-token",
      moduleCount: 6,
    });

    expect(readCurrentTick(cwd)).toBe(120);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
