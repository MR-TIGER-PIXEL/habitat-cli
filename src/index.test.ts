import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getRegistrationStatus,
  registerHabitat,
  unregisterHabitat,
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

test("register writes .habitat/registration.json with the OpenAPI request keys", async () => {
  const cwd = createWorkspace();
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];

  const fetchMock: FetchLike = async (url, init) => {
    const requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: requestBody,
    });

    return new Response(
      JSON.stringify({
        habitatId: "habitat_11111111_1111_4111_8111_111111111111",
        starterModules: [],
        blueprints: [],
      }),
      {
        status: 201,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const config: CliConfig = {
    baseUrl: "https://planet.turingguild.com",
    token: "test-token",
    cwd,
    fetchImpl: fetchMock,
  };

  const result = await registerHabitat(config, "Starlight Forge");

  expect(result.registration.displayName).toBe("Starlight Forge");
  expect(result.registration.habitatId).toBe("habitat_11111111_1111_4111_8111_111111111111");
  expect(result.registration.baseUrl).toBe("https://planet.turingguild.com");
  expect(result.registration.habitatUuid).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

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

  const registrationPath = path.join(cwd, ".habitat", "registration.json");
  expect(existsSync(registrationPath)).toBe(true);
  expect(JSON.parse(readFileSync(registrationPath, "utf8"))).toEqual(result.registration);

  rmSync(cwd, { recursive: true, force: true });
});

test("status reads the saved registration and fetches remote habitat details", async () => {
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

  const requests: string[] = [];
  const fetchMock: FetchLike = async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(
      JSON.stringify({
        habitat: {
          id: "habitat_11111111_1111_4111_8111_111111111111",
          habitatSlug: "starlight-forge",
          displayName: "Starlight Forge",
          catalogVersion: "2026-07-06",
          status: "active",
          lastSeenAt: "2026-07-06T12:00:00.000Z",
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const result = await getRegistrationStatus({
    baseUrl: "https://planet.turingguild.com",
    token: "test-token",
    cwd,
    fetchImpl: fetchMock,
  });

  expect(requests).toEqual([
    "GET https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111/registration",
  ]);
  expect(result.registration.displayName).toBe("Starlight Forge");
  expect(result.habitat.status).toBe("active");
  expect(result.habitat.habitatSlug).toBe("starlight-forge");

  rmSync(cwd, { recursive: true, force: true });
});

test("unregister deletes the saved registration after a successful delete", async () => {
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

  const requests: string[] = [];
  const fetchMock: FetchLike = async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${String(url)}`);
    return new Response(null, { status: 204 });
  };

  const result = await unregisterHabitat({
    baseUrl: "https://planet.turingguild.com",
    token: "test-token",
    cwd,
    fetchImpl: fetchMock,
  });

  expect(requests).toEqual([
    "DELETE https://planet.turingguild.com/habitats/habitat_11111111_1111_4111_8111_111111111111",
  ]);
  expect(result.displayName).toBe("Starlight Forge");
  expect(existsSync(path.join(habitatDirectory, "registration.json"))).toBe(false);

  rmSync(cwd, { recursive: true, force: true });
});
