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

export type RuntimeAttributes = Record<string, unknown>;
export const MODULE_RUNTIME_STATUSES = [
  "offline",
  "idle",
  "online",
  "active",
  "damaged",
] as const;
export type ModuleRuntimeStatus = (typeof MODULE_RUNTIME_STATUSES)[number];

export type StoredBlueprint = {
  id: string;
  blueprintId: string;
  displayName: string;
  description: string;
  status: "draft" | "published";
  output: Record<string, unknown>;
  inputs: Record<string, unknown>;
  productionCost?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
  buildTicks: number;
  prerequisites?: string[];
  unlocks?: string[];
  repeatable: boolean;
  level?: number | null;
  target?: Record<string, unknown>;
  facilityLevel?: Record<string, unknown>;
  attachmentPoints?: Record<string, unknown>;
  attachmentRequirements?: Array<Record<string, unknown>>;
  runtimeAttributes?: RuntimeAttributes;
  capabilities?: string[];
};

export type LocalHabitatModule = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: RuntimeAttributes;
  capabilities: string[];
  source: "registration" | "local";
};

type StarterModuleInstance = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: RuntimeAttributes;
  capabilities: string[];
};

type HabitatRegistrationResponse = {
  habitatId: string;
  starterModules: StarterModuleInstance[];
  blueprints: StoredBlueprint[];
};

type HabitatResponse = {
  habitat: HabitatDetails;
};

type BlueprintCatalogResponse = {
  catalogVersion: string;
  blueprints: StoredBlueprint[];
};

type BlueprintResponse = {
  blueprint: StoredBlueprint;
};

export type OfficialResource = {
  id: string;
  resourceType: string;
  displayName: string;
  kind: string;
  rarity: string;
  description?: string;
  unit?: string;
};

type ResourceCatalogResponse = {
  catalogVersion: string;
  resources: OfficialResource[];
};

export type ModuleCreateInput = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo?: string[];
  runtimeAttributes?: RuntimeAttributes;
  capabilities?: string[];
};

export type ModuleUpdateInput = {
  displayName?: string;
  connectedTo?: string[];
  runtimeAttributes?: RuntimeAttributes;
  capabilities?: string[];
};

export type TickState = {
  currentTick: number;
};

export type TickBatterySummary = {
  id: string;
  alias: string;
  currentEnergyKwh: number;
};

export type ModulePowerStatusRow = {
  displayName: string;
  status: ModuleRuntimeStatus;
  currentPowerDrawKw: number;
};

const DEFAULT_BASE_URL = "https://planet.turingguild.com";
const HABITAT_DIRECTORY = ".habitat";
const REGISTRATION_FILE = "registration.json";
const MODULES_FILE = "modules.json";
const BLUEPRINTS_FILE = "blueprints.json";
const STATE_FILE = "state.json";

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
  modules: LocalHabitatModule[];
  blueprints: Record<string, StoredBlueprint>;
}> {
  if (readStoredRegistration(config.cwd)) {
    throw new CliError(
      "Habitat is already registered locally. Run `habitat status` or `habitat unregister`.",
    );
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

  const modules = response.starterModules.map(hydrateStarterModule);
  const blueprints = indexBlueprintsById(response.blueprints);

  writeStoredRegistration(config.cwd, registration);
  writeStoredModules(config.cwd, modules);
  writeStoredBlueprints(config.cwd, blueprints);

  return { registration, response, modules, blueprints };
}

export async function getRegistrationStatus(config: CliConfig): Promise<{
  registration: RegistrationRecord;
  habitat: HabitatDetails;
  moduleCount: number;
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
    moduleCount: readStoredModules(config.cwd).length,
  };
}

export async function unregisterHabitat(config: CliConfig): Promise<RegistrationRecord> {
  const registration = requireStoredRegistration(config.cwd);
  await requestWithoutJson(config, `/habitats/${registration.habitatId}`, {
    method: "DELETE",
  });
  deleteStoredState(config.cwd);
  return registration;
}

export async function listOfficialBlueprints(config: CliConfig): Promise<BlueprintCatalogResponse> {
  return requestJson<BlueprintCatalogResponse>(config, "/catalog/blueprints", {
    method: "GET",
  });
}

export async function listOfficialResources(config: CliConfig): Promise<ResourceCatalogResponse> {
  return requestJson<ResourceCatalogResponse>(config, "/catalog/resources", {
    method: "GET",
  });
}

export async function getOfficialBlueprint(
  config: CliConfig,
  blueprintId: string,
): Promise<StoredBlueprint> {
  try {
    const response = await requestJson<BlueprintResponse>(
      config,
      `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
      {
        method: "GET",
      },
    );

    return response.blueprint;
  } catch (error) {
    if (
      error instanceof CliError
      && (error.message.includes("404") || error.message.includes("No blueprint with that id"))
    ) {
      throw new CliError(`Blueprint "${blueprintId}" was not found in the Kepler catalog.`);
    }

    throw error;
  }
}

export function readTickState(cwd: string): TickState {
  const statePath = getStatePath(cwd);
  if (!existsSync(statePath)) {
    return { currentTick: 0 };
  }

  return JSON.parse(readFileSync(statePath, "utf8")) as TickState;
}

export function listModules(config: CliConfig): LocalHabitatModule[] {
  requireStoredRegistration(config.cwd);
  return readStoredModules(config.cwd);
}

export function resolveModuleReference(config: CliConfig, reference: string): LocalHabitatModule {
  requireStoredRegistration(config.cwd);
  return resolveModuleReferenceFromModules(readStoredModules(config.cwd), reference);
}

export function showModule(
  config: CliConfig,
  moduleReference: string,
): { module: LocalHabitatModule; blueprint: StoredBlueprint | null } {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);
  const module = resolveModuleReferenceFromModules(modules, moduleReference);

  const blueprint = readStoredBlueprints(config.cwd)[module.blueprintId] ?? null;
  return { module, blueprint };
}

export function createModule(config: CliConfig, input: ModuleCreateInput): LocalHabitatModule {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);

  if (modules.some((module) => module.id === input.id)) {
    throw new CliError(`Module "${input.id}" already exists.`);
  }

  const module: LocalHabitatModule = {
    id: input.id,
    blueprintId: input.blueprintId,
    displayName: input.displayName,
    connectedTo: input.connectedTo ?? [],
    runtimeAttributes: input.runtimeAttributes ?? {},
    capabilities: input.capabilities ?? [],
    source: "local",
  };

  modules.push(module);
  writeStoredModules(config.cwd, modules);
  return module;
}

export function updateModule(
  config: CliConfig,
  moduleReference: string,
  input: ModuleUpdateInput,
): LocalHabitatModule {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);
  const module = resolveModuleReferenceFromModules(modules, moduleReference);

  if (input.displayName !== undefined) {
    module.displayName = input.displayName;
  }

  if (input.connectedTo !== undefined) {
    module.connectedTo = input.connectedTo;
  }

  if (input.runtimeAttributes !== undefined) {
    module.runtimeAttributes = input.runtimeAttributes;
  }

  if (input.capabilities !== undefined) {
    module.capabilities = input.capabilities;
  }

  writeStoredModules(config.cwd, modules);
  return module;
}

export function deleteModule(config: CliConfig, moduleId: string): LocalHabitatModule {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);
  const targetModule = resolveModuleReferenceFromModules(modules, moduleId);
  const index = modules.findIndex((item) => item.id === targetModule.id);

  const [removed] = modules.splice(index, 1);
  writeStoredModules(config.cwd, modules);
  return removed;
}

export function setModuleStatus(
  config: CliConfig,
  moduleReference: string,
  status: ModuleRuntimeStatus,
): {
  module: LocalHabitatModule;
  currentPowerDrawKw: number;
} {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);
  const module = resolveModuleReferenceFromModules(modules, moduleReference);

  module.runtimeAttributes.status = status;
  writeStoredModules(config.cwd, modules);

  return {
    module,
    currentPowerDrawKw: getModuleCurrentPowerDrawKw(module),
  };
}

export function runPowerTicks(
  config: CliConfig,
  count: number,
): {
  startTick: number;
  endTick: number;
  totalEnergyUsedKwh: number;
  batteries: TickBatterySummary[];
} {
  requireStoredRegistration(config.cwd);

  if (!Number.isInteger(count) || count <= 0) {
    throw new CliError("Invalid tick count. Use a positive integer.");
  }

  const modules = readStoredModules(config.cwd);
  const state = readTickState(config.cwd);
  const startTick = state.currentTick;
  let totalEnergyUsedKwh = 0;

  for (let tick = 0; tick < count; tick += 1) {
    const tickEnergyUsedKwh = modules.reduce(
      (sum, module) => sum + getModuleCurrentPowerDrawKw(module) / 3600,
      0,
    );

    drainBatteries(modules, tickEnergyUsedKwh);
    totalEnergyUsedKwh += tickEnergyUsedKwh;
    state.currentTick += 1;
  }

  writeStoredModules(config.cwd, modules);
  writeTickState(config.cwd, state);

  const batteries = modules
    .filter(isBatteryModule)
    .map((module) => ({
      id: module.id,
      alias: getModuleAlias(module, modules),
      currentEnergyKwh: getBatteryEnergy(module),
    }));

  return {
    startTick,
    endTick: state.currentTick,
    totalEnergyUsedKwh,
    batteries,
  };
}

export function formatModuleListEntry(
  module: LocalHabitatModule,
  modules: LocalHabitatModule[],
): string {
  return `${getModuleAlias(module, modules)} | ${module.displayName} | ${module.blueprintId} | source=${module.source}`;
}

export function getModulePowerStatus(
  config: CliConfig,
): {
  rows: ModulePowerStatusRow[];
  totalCurrentPowerDrawKw: number;
  oneTickEnergyCostKwh: number;
} {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);
  const rows = modules.map((module) => {
    const status = getDisplayedModuleStatus(module);
    const currentPowerDrawKw = getModuleCurrentPowerDrawKw(module);

    return {
      displayName: module.displayName,
      status,
      currentPowerDrawKw,
    };
  });

  const totalCurrentPowerDrawKw = rows.reduce((sum, row) => sum + row.currentPowerDrawKw, 0);

  return {
    rows,
    totalCurrentPowerDrawKw,
    oneTickEnergyCostKwh: totalCurrentPowerDrawKw / 3600,
  };
}

export function parseJsonArray(value: string, label: string): string[] {
  const parsed = parseJsonValue(value, label);

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new CliError(`Invalid ${label}. Use a JSON array of strings.`);
  }

  return parsed;
}

export function parseJsonObject(value: string, label: string): RuntimeAttributes {
  const parsed = parseJsonValue(value, label);

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new CliError(`Invalid ${label}. Use a JSON object.`);
  }

  return parsed as RuntimeAttributes;
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CliError(`Invalid ${label}. Use valid JSON.`);
  }
}

function resolveModuleReferenceFromModules(
  modules: LocalHabitatModule[],
  reference: string,
): LocalHabitatModule {
  const exactMatch = modules.find((item) => item.id === reference);
  if (exactMatch) {
    return exactMatch;
  }

  const aliasMatch = modules.find((item) => getModuleAlias(item, modules) === reference);
  if (aliasMatch) {
    return aliasMatch;
  }

  throw new CliError(`Module "${reference}" not found.`);
}

function getModuleAlias(module: LocalHabitatModule, modules: LocalHabitatModule[]): string {
  const aliasBase = buildAliasBase(module.displayName, module.blueprintId);
  const matchingModules = modules.filter(
    (item) => buildAliasBase(item.displayName, item.blueprintId) === aliasBase,
  );
  const position = matchingModules.findIndex((item) => item.id === module.id);
  return `${aliasBase}-${position + 1}`;
}

function buildAliasBase(displayName: string, blueprintId: string): string {
  const blueprintTokens = blueprintId
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (blueprintTokens.length >= 2) {
    return blueprintTokens.map((token) => token[0]).join("");
  }

  const nameTokens = displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (nameTokens.length >= 2) {
    return nameTokens.map((token) => token[0]).join("");
  }

  const singleToken = nameTokens[0] ?? blueprintTokens[0] ?? "mod";
  return singleToken.slice(0, 3);
}

function hydrateStarterModule(module: StarterModuleInstance): LocalHabitatModule {
  return {
    id: module.id,
    blueprintId: module.blueprintId,
    displayName: module.displayName,
    connectedTo: Array.isArray(module.connectedTo) ? module.connectedTo : [],
    runtimeAttributes:
      module.runtimeAttributes && typeof module.runtimeAttributes === "object"
        ? module.runtimeAttributes
        : {},
    capabilities: Array.isArray(module.capabilities) ? module.capabilities : [],
    source: "registration",
  };
}

function indexBlueprintsById(blueprints: StoredBlueprint[]): Record<string, StoredBlueprint> {
  return Object.fromEntries(blueprints.map((blueprint) => [blueprint.blueprintId, blueprint]));
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

function getModulesPath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), MODULES_FILE);
}

function getBlueprintsPath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), BLUEPRINTS_FILE);
}

function getStatePath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), STATE_FILE);
}

function ensureHabitatDirectory(cwd: string): void {
  const habitatDirectory = getHabitatDirectory(cwd);
  if (!existsSync(habitatDirectory)) {
    mkdirSync(habitatDirectory, { recursive: true });
  }
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
    throw new CliError(
      'No local habitat registration found. Run `habitat register --name "<name>"` first.',
    );
  }

  return registration;
}

function writeStoredRegistration(cwd: string, registration: RegistrationRecord): void {
  ensureHabitatDirectory(cwd);
  writeFileSync(getRegistrationPath(cwd), `${JSON.stringify(registration, null, 2)}\n`);
}

function readStoredModules(cwd: string): LocalHabitatModule[] {
  const modulesPath = getModulesPath(cwd);
  if (!existsSync(modulesPath)) {
    return [];
  }

  return JSON.parse(readFileSync(modulesPath, "utf8")) as LocalHabitatModule[];
}

function writeStoredModules(cwd: string, modules: LocalHabitatModule[]): void {
  ensureHabitatDirectory(cwd);
  writeFileSync(getModulesPath(cwd), `${JSON.stringify(modules, null, 2)}\n`);
}

function readStoredBlueprints(cwd: string): Record<string, StoredBlueprint> {
  const blueprintsPath = getBlueprintsPath(cwd);
  if (!existsSync(blueprintsPath)) {
    return {};
  }

  return JSON.parse(readFileSync(blueprintsPath, "utf8")) as Record<string, StoredBlueprint>;
}

function writeStoredBlueprints(cwd: string, blueprints: Record<string, StoredBlueprint>): void {
  ensureHabitatDirectory(cwd);
  writeFileSync(getBlueprintsPath(cwd), `${JSON.stringify(blueprints, null, 2)}\n`);
}

function writeTickState(cwd: string, state: TickState): void {
  ensureHabitatDirectory(cwd);
  writeFileSync(getStatePath(cwd), `${JSON.stringify(state, null, 2)}\n`);
}

function deleteStoredState(cwd: string): void {
  for (const filePath of [
    getRegistrationPath(cwd),
    getModulesPath(cwd),
    getBlueprintsPath(cwd),
    getStatePath(cwd),
  ]) {
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  }
}

function isBatteryModule(module: LocalHabitatModule): boolean {
  return typeof module.runtimeAttributes.currentEnergyKwh === "number"
    && typeof module.runtimeAttributes.energyStorageKwh === "number";
}

function getBatteryEnergy(module: LocalHabitatModule): number {
  return typeof module.runtimeAttributes.currentEnergyKwh === "number"
    ? module.runtimeAttributes.currentEnergyKwh
    : 0;
}

function drainBatteries(modules: LocalHabitatModule[], energyUsedKwh: number): void {
  if (energyUsedKwh <= 0) {
    return;
  }

  const batteries = modules.filter(
    (module) => isBatteryModule(module) && getBatteryEnergy(module) > 0,
  );

  const totalAvailableEnergy = batteries.reduce(
    (sum, module) => sum + getBatteryEnergy(module),
    0,
  );

  if (totalAvailableEnergy <= 0) {
    return;
  }

  for (const battery of batteries) {
    const currentEnergy = getBatteryEnergy(battery);
    const share = currentEnergy / totalAvailableEnergy;
    const drained = energyUsedKwh * share;
    battery.runtimeAttributes.currentEnergyKwh = Math.max(0, currentEnergy - drained);
  }
}

function getModuleCurrentPowerDrawKw(module: LocalHabitatModule): number {
  const rawStatus =
    typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : null;
  const displayedStatus = getDisplayedModuleStatus(module);
  const powerDraw = module.runtimeAttributes.powerDrawKw;

  if (!powerDraw || typeof powerDraw !== "object" || Array.isArray(powerDraw)) {
    return 0;
  }

  const lookup = powerDraw as Record<string, unknown>;

  if (rawStatus) {
    const rawPowerKw = lookup[rawStatus];
    if (typeof rawPowerKw === "number") {
      return rawPowerKw;
    }
  }

  const normalizedPowerKw = lookup[displayedStatus];
  return typeof normalizedPowerKw === "number" ? normalizedPowerKw : 0;
}

function getDisplayedModuleStatus(
  module: LocalHabitatModule,
): ModuleRuntimeStatus {
  const rawStatus =
    typeof module.runtimeAttributes.status === "string"
      ? module.runtimeAttributes.status.toLowerCase()
      : "";

  if (
    rawStatus === "online" ||
    rawStatus === "offline" ||
    rawStatus === "idle" ||
    rawStatus === "active" ||
    rawStatus === "damaged"
  ) {
    return rawStatus;
  }

  if (rawStatus === "maintenance") {
    return "offline";
  }

  return "offline";
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
