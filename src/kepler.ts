import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type FetchLike = typeof fetch;

export type CliConfig = {
  baseUrl: string;
  token: string;
  cwd: string;
  fetchImpl?: FetchLike;
};

export type RegistrationRecord = {
  displayName: string;
  habitatUuid: string;
  habitatId: string;
  baseUrl: string;
};

export type HabitatDetails = {
  id: string;
  habitatSlug: string;
  displayName: string;
  catalogVersion: string;
  status: string;
  lastSeenAt: string | null;
};

type HabitatRegistrationResponse = {
  habitatId: string;
  starterModules: unknown[];
  blueprints: unknown[];
};

type HabitatResponse = {
  habitat: HabitatDetails;
};

const DEFAULT_BASE_URL = "https://planet.turingguild.com";
const HABITAT_DIRECTORY = ".habitat";
const REGISTRATION_FILE = "registration.json";

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function readEnvironmentFile(cwd: string): Record<string, string> {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) {
    return {};
  }

  const values: Record<string, string> = {};
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    values[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return values;
}

export function resolveConfig(cwd: string): CliConfig {
  const envFileValues = readEnvironmentFile(cwd);
  const baseUrl = normalizeBaseUrl(
    process.env.KEPLER_BASE_URL ?? envFileValues.KEPLER_BASE_URL ?? DEFAULT_BASE_URL,
  );
  const token = process.env.KEPLER_PLANET_TOKEN ?? envFileValues.KEPLER_PLANET_TOKEN;

  if (!token) {
    throw new CliError(
      'Missing Kepler token. Set "KEPLER_PLANET_TOKEN" in your environment or .env file.',
    );
  }

  return {
    baseUrl,
    token,
    cwd,
  };
}

export async function registerHabitat(
  config: CliConfig,
  displayName: string,
): Promise<{
  registration: RegistrationRecord;
  response: HabitatRegistrationResponse;
}> {
  if (readStoredRegistration(config.cwd)) {
    throw new CliError("Habitat is already registered locally. Run `habitat status` or `habitat unregister`.");
  }

  const habitatUuid = crypto.randomUUID();
  const response = await requestJson<HabitatRegistrationResponse>(
    config,
    "/habitats/register",
    {
      method: "POST",
      body: JSON.stringify({
        displayName,
        habitatUuid,
      }),
    },
  );

  const registration: RegistrationRecord = {
    displayName,
    habitatUuid,
    habitatId: response.habitatId,
    baseUrl: config.baseUrl,
  };

  writeStoredRegistration(config.cwd, registration);

  return { registration, response };
}

export async function getRegistrationStatus(config: CliConfig): Promise<{
  registration: RegistrationRecord;
  habitat: HabitatDetails;
}> {
  const registration = requireStoredRegistration(config.cwd);
  const response = await requestJson<HabitatResponse>(
    config,
    `/habitats/${registration.habitatId}/registration`,
    {
      method: "GET",
    },
  );

  return {
    registration,
    habitat: response.habitat,
  };
}

export async function unregisterHabitat(config: CliConfig): Promise<RegistrationRecord> {
  const registration = requireStoredRegistration(config.cwd);
  await requestWithoutJson(config, `/habitats/${registration.habitatId}`, {
    method: "DELETE",
  });
  deleteStoredRegistration(config.cwd);
  return registration;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getHabitatDirectory(cwd: string): string {
  return path.join(cwd, HABITAT_DIRECTORY);
}

function getRegistrationPath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), REGISTRATION_FILE);
}

function readStoredRegistration(cwd: string): RegistrationRecord | null {
  const registrationPath = getRegistrationPath(cwd);
  if (!existsSync(registrationPath)) {
    return null;
  }

  return JSON.parse(readFileSync(registrationPath, "utf8")) as RegistrationRecord;
}

function requireStoredRegistration(cwd: string): RegistrationRecord {
  const registration = readStoredRegistration(cwd);
  if (!registration) {
    throw new CliError("No local habitat registration found. Run `habitat register --name \"<name>\"` first.");
  }

  return registration;
}

function writeStoredRegistration(cwd: string, registration: RegistrationRecord): void {
  const habitatDirectory = getHabitatDirectory(cwd);
  if (!existsSync(habitatDirectory)) {
    mkdirSync(habitatDirectory, { recursive: true });
  }

  writeFileSync(getRegistrationPath(cwd), `${JSON.stringify(registration, null, 2)}\n`);
}

function deleteStoredRegistration(cwd: string): void {
  const registrationPath = getRegistrationPath(cwd);
  if (existsSync(registrationPath)) {
    rmSync(registrationPath, { force: true });
  }
}

async function requestJson<T>(
  config: CliConfig,
  endpoint: string,
  init: RequestInit,
): Promise<T> {
  const response = await request(config, endpoint, init);
  return (await response.json()) as T;
}

async function requestWithoutJson(
  config: CliConfig,
  endpoint: string,
  init: RequestInit,
): Promise<void> {
  await request(config, endpoint, init);
}

async function request(
  config: CliConfig,
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await fetchImpl(`${config.baseUrl}${endpoint}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }

  return response;
}

async function createResponseError(response: Response): Promise<CliError> {
  try {
    const parsed = (await response.json()) as {
      error?: {
        message?: string;
      };
    };

    if (parsed.error?.message) {
      return new CliError(parsed.error.message);
    }
  } catch {
    // Fall back to HTTP status text when no JSON error envelope is available.
  }

  return new CliError(`Kepler request failed with ${response.status} ${response.statusText}.`);
}
