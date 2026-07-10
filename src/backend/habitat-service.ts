import { createApiClient } from "../api/client";
import {
  deleteRegistration,
  readInventory,
  readCurrentTick,
  readModules,
  readRegistration,
  writeInventory,
  writeModules,
  writeRegistration,
  type BackendRegistration,
  type BackendInventoryEntry,
} from "./registration-store";
import {
  cancelConstructionJob,
  listActiveConstructionJobs,
  planConstruction,
  resolveConfig,
  runPowerTicks,
  startConstruction,
  writeBlueprintCatalog,
  type ConstructionPlan,
  type StartedConstruction,
  type SolarIrradiance,
} from "../kepler";
import type {
  LocalHabitatModule,
  ModuleRuntimeStatus,
  StoredBlueprint,
} from "../kepler";

type KeplerRegistrationResponse = {
  habitatId: string;
  starterModules: Array<unknown>;
  blueprints: StoredBlueprint[];
};

type KeplerStatusResponse = {
  habitat: {
    habitatSlug: string;
    status: string;
    catalogVersion: string;
    lastSeenAt: string | null;
  };
};

type KeplerBlueprintCatalogResponse = {
  catalogVersion: string;
  blueprints: Array<unknown>;
};

type KeplerBlueprintResponse = {
  blueprint: unknown;
};

type KeplerResourceCatalogResponse = {
  catalogVersion: string;
  resources: Array<unknown>;
};

type KeplerSolarResponse = {
  irradianceWPerM2: number;
  condition: string;
};

type KeplerEnvironment = {
  baseUrl: string;
  token: string;
};

export async function getRegistration(cwd: string): Promise<BackendRegistration | null> {
  return readRegistration(cwd);
}

export async function registerHabitat(
  cwd: string,
  displayName: string,
): Promise<{
  registration: BackendRegistration | null;
  response: KeplerRegistrationResponse;
}> {
  if (readRegistration(cwd)) {
    throw new Error("Habitat is already registered.");
  }

  const kepler = createKeplerClient();
  const habitatUuid = crypto.randomUUID();
  const response = await kepler.requestJson<KeplerRegistrationResponse>("/habitats/register", {
    method: "POST",
    body: JSON.stringify({ displayName, habitatUuid }),
  });

  const registration: BackendRegistration = {
    habitatUuid,
    habitatId: response.habitatId,
    displayName,
    apiToken: crypto.randomUUID(),
    moduleCount: response.starterModules.length,
  };

  writeRegistration(cwd, registration);
  writeModules(cwd, response.starterModules.map(hydrateStarterModule));
  writeBlueprintCatalog(cwd, Object.fromEntries(
    response.blueprints.map((blueprint) => [blueprint.blueprintId, blueprint]),
  ));

  return {
    registration,
    response,
  };
}

export async function getStatus(cwd: string): Promise<{
  registration: BackendRegistration;
  habitat: KeplerStatusResponse["habitat"];
  moduleCount: number;
  currentTick: number;
}> {
  const registration = readRegistration(cwd);
  if (!registration) {
    throw new Error("No habitat registration found.");
  }

  const kepler = createKeplerClient();
  const response = await kepler.requestJson<KeplerStatusResponse>(
    `/habitats/${registration.habitatId}/registration`,
    {
      method: "GET",
    },
  );

  return {
    registration,
    habitat: response.habitat,
    moduleCount: readModules(cwd).length,
    currentTick: readCurrentTick(cwd),
  };
}

export async function unregisterHabitat(cwd: string): Promise<BackendRegistration> {
  const registration = readRegistration(cwd);
  if (!registration) {
    throw new Error("No habitat registration found.");
  }

  const kepler = createKeplerClient();
  await kepler.requestWithoutJson(`/habitats/${registration.habitatId}`, {
    method: "DELETE",
  });

  deleteRegistration(cwd);
  return registration;
}

export async function listModules(cwd: string): Promise<LocalHabitatModule[]> {
  ensureRegistered(cwd);
  return readModules(cwd);
}

export async function getModule(cwd: string, moduleReference: string): Promise<{
  module: LocalHabitatModule;
  modules: LocalHabitatModule[];
  blueprint: StoredBlueprint | null;
}> {
  ensureRegistered(cwd);
  const modules = readModules(cwd);
  const module = resolveModuleReference(modules, moduleReference);
  const blueprint = (await getOfficialBlueprint(module.blueprintId)).blueprint as StoredBlueprint;
  return { module, modules, blueprint };
}

export async function createModule(
  cwd: string,
  input: {
    id: string;
    blueprintId: string;
    displayName: string;
    connectedTo?: string[];
    runtimeAttributes?: Record<string, unknown>;
    capabilities?: string[];
  },
): Promise<LocalHabitatModule> {
  ensureRegistered(cwd);
  const modules = readModules(cwd);

  if (modules.some((module) => module.id === input.id)) {
    throw new Error(`Module "${input.id}" already exists.`);
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
  writeModules(cwd, modules);
  syncModuleCount(cwd, modules.length);
  return module;
}

export async function updateModule(
  cwd: string,
  moduleReference: string,
  input: {
    displayName?: string;
    connectedTo?: string[];
    runtimeAttributes?: Record<string, unknown>;
    capabilities?: string[];
  },
): Promise<LocalHabitatModule> {
  ensureRegistered(cwd);
  const modules = readModules(cwd);
  const module = resolveModuleReference(modules, moduleReference);
  if (input.displayName !== undefined) module.displayName = input.displayName;
  if (input.connectedTo !== undefined) module.connectedTo = input.connectedTo;
  if (input.runtimeAttributes !== undefined) module.runtimeAttributes = input.runtimeAttributes;
  if (input.capabilities !== undefined) module.capabilities = input.capabilities;
  writeModules(cwd, modules);
  return module;
}

export async function deleteModule(cwd: string, moduleReference: string): Promise<LocalHabitatModule> {
  ensureRegistered(cwd);
  const modules = readModules(cwd);
  const target = resolveModuleReference(modules, moduleReference);
  const index = modules.findIndex((item) => item.id === target.id);
  const [removed] = modules.splice(index, 1);
  writeModules(cwd, modules);
  syncModuleCount(cwd, modules.length);
  return removed;
}

export async function setModuleStatus(
  cwd: string,
  moduleReference: string,
  status: ModuleRuntimeStatus,
): Promise<{
  module: LocalHabitatModule;
  currentPowerDrawKw: number;
}> {
  ensureRegistered(cwd);
  const modules = readModules(cwd);
  const module = resolveModuleReference(modules, moduleReference);
  module.runtimeAttributes.status = status;
  writeModules(cwd, modules);
  return {
    module,
    currentPowerDrawKw: getModuleCurrentPowerDrawKw(module),
  };
}

export async function getModulePowerStatus(cwd: string): Promise<{
  rows: Array<{
    displayName: string;
    declaredStatus: string;
    effectiveState: ModuleRuntimeStatus | "busy";
    currentPowerDrawKw: number;
  }>;
  totalCurrentPowerDrawKw: number;
  oneTickEnergyCostKwh: number;
}> {
  ensureRegistered(cwd);
  const modules = readModules(cwd);
  const rows = modules.map((module) => ({
    displayName: module.displayName,
    declaredStatus: typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : "(unset)",
    effectiveState: getEffectiveModuleState(module),
    currentPowerDrawKw: getModuleCurrentPowerDrawKw(module),
  }));
  const totalCurrentPowerDrawKw = rows.reduce((sum, row) => sum + row.currentPowerDrawKw, 0);
  return {
    rows,
    totalCurrentPowerDrawKw,
    oneTickEnergyCostKwh: totalCurrentPowerDrawKw / 3600,
  };
}

export async function advanceTicks(cwd: string, count: number): Promise<ReturnType<typeof runPowerTicks>> {
  ensureRegistered(cwd);
  const solar = await getSolarIrradiance();
  return runPowerTicks(resolveConfig(cwd), count, solar as SolarIrradiance);
}

export function planConstructionForHabitat(cwd: string, blueprintId: string): ConstructionPlan {
  ensureRegistered(cwd);
  return planConstruction(resolveConfig(cwd), blueprintId);
}

export async function startConstructionForHabitat(cwd: string, blueprintId: string): Promise<StartedConstruction> {
  ensureRegistered(cwd);
  return startConstruction(resolveConfig(cwd), blueprintId);
}

export function listConstructionJobs(cwd: string) {
  ensureRegistered(cwd);
  return listActiveConstructionJobs(resolveConfig(cwd));
}

export function cancelConstructionForHabitat(cwd: string, moduleReference: string) {
  ensureRegistered(cwd);
  return cancelConstructionJob(resolveConfig(cwd), moduleReference);
}

export async function listInventory(cwd: string): Promise<BackendInventoryEntry[]> {
  ensureRegistered(cwd);
  return Object.entries(readInventory(cwd))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceType, quantity]) => ({ resourceType, quantity }));
}

export async function addInventoryResource(
  cwd: string,
  resourceType: string,
  quantity: number,
): Promise<BackendInventoryEntry> {
  ensureRegistered(cwd);
  if (!resourceType.trim()) {
    throw new Error("Invalid resource type. Use a non-empty resource type string.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity "${quantity}". Use a positive integer.`);
  }
  const inventory = readInventory(cwd);
  inventory[resourceType] = (inventory[resourceType] ?? 0) + quantity;
  writeInventory(cwd, inventory);
  return { resourceType, quantity: inventory[resourceType] };
}

export async function removeInventoryResource(
  cwd: string,
  resourceType: string,
  quantity: number,
): Promise<BackendInventoryEntry> {
  ensureRegistered(cwd);
  if (!resourceType.trim()) {
    throw new Error("Invalid resource type. Use a non-empty resource type string.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity "${quantity}". Use a positive integer.`);
  }
  const inventory = readInventory(cwd);
  const currentQuantity = inventory[resourceType] ?? 0;
  const nextQuantity = Math.max(0, currentQuantity - quantity);
  inventory[resourceType] = nextQuantity;
  if (nextQuantity === 0) {
    delete inventory[resourceType];
  }
  writeInventory(cwd, inventory);
  return { resourceType, quantity: nextQuantity };
}

export async function listOfficialBlueprints(): Promise<KeplerBlueprintCatalogResponse> {
  const kepler = createKeplerClient();
  return kepler.requestJson<KeplerBlueprintCatalogResponse>("/catalog/blueprints", {
    method: "GET",
  });
}

export async function getOfficialBlueprint(blueprintId: string): Promise<KeplerBlueprintResponse> {
  const kepler = createKeplerClient();
  return kepler.requestJson<KeplerBlueprintResponse>(
    `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
    {
      method: "GET",
    },
  );
}

export async function listOfficialResources(): Promise<KeplerResourceCatalogResponse> {
  const kepler = createKeplerClient();
  return kepler.requestJson<KeplerResourceCatalogResponse>("/catalog/resources", {
    method: "GET",
  });
}

export async function getSolarIrradiance(): Promise<KeplerSolarResponse> {
  const kepler = createKeplerClient();
  return kepler.requestJson<KeplerSolarResponse>("/world/solar-irradiance", {
    method: "GET",
  });
}

function createKeplerClient() {
  const env = readKeplerEnvironment();
  return createApiClient({
    baseUrl: env.baseUrl,
    headers: {
      authorization: `Bearer ${env.token}`,
    },
    fetchImpl: Object.assign(async (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const parsed = new URL(url);
      const response = await fetch(input, init);
      console.log(`[kepler] ${method} ${parsed.pathname} -> ${response.status}`);
      return response;
    }, {
      preconnect: fetch.preconnect.bind(fetch),
    }) as typeof fetch,
  });
}

function hydrateStarterModule(module: unknown): LocalHabitatModule {
  const starterModule = module as {
    id: string;
    blueprintId: string;
    displayName: string;
    connectedTo?: unknown;
    runtimeAttributes?: unknown;
    capabilities?: unknown;
  };

  return {
    id: starterModule.id,
    blueprintId: starterModule.blueprintId,
    displayName: starterModule.displayName,
    connectedTo: Array.isArray(starterModule.connectedTo) ? starterModule.connectedTo as string[] : [],
    runtimeAttributes:
      starterModule.runtimeAttributes && typeof starterModule.runtimeAttributes === "object"
        ? starterModule.runtimeAttributes as LocalHabitatModule["runtimeAttributes"]
        : {},
    capabilities: Array.isArray(starterModule.capabilities) ? starterModule.capabilities as string[] : [],
    source: "registration",
  };
}

function ensureRegistered(cwd: string): void {
  if (!readRegistration(cwd)) {
    throw new Error("No habitat registration found.");
  }
}

function syncModuleCount(cwd: string, moduleCount: number): void {
  const registration = readRegistration(cwd);
  if (!registration) {
    return;
  }
  writeRegistration(cwd, { ...registration, moduleCount });
}

function resolveModuleReference(modules: LocalHabitatModule[], reference: string): LocalHabitatModule {
  const exactMatch = modules.find((item) => item.id === reference);
  if (exactMatch) return exactMatch;
  const aliasMatch = modules.find((item) => getModuleAlias(item, modules) === reference);
  if (aliasMatch) return aliasMatch;
  const generatedNameMatch = modules.find((item) => getModuleGeneratedName(item, modules) === reference);
  if (generatedNameMatch) return generatedNameMatch;
  throw new Error(`Module "${reference}" not found.`);
}

function getModuleAlias(module: LocalHabitatModule, modules: LocalHabitatModule[]): string {
  const aliasBase = buildAliasBase(module.displayName, module.blueprintId);
  const matchingModules = modules.filter(
    (item) => buildAliasBase(item.displayName, item.blueprintId) === aliasBase,
  );
  const position = matchingModules.findIndex((item) => item.id === module.id);
  return `${aliasBase}-${position + 1}`;
}

function getModuleGeneratedName(module: LocalHabitatModule, modules: LocalHabitatModule[]): string {
  const matchingModules = modules.filter((item) => item.blueprintId === module.blueprintId);
  const position = matchingModules.findIndex((item) => item.id === module.id);
  return `${module.blueprintId}-${position + 1}`;
}

function buildAliasBase(displayName: string, blueprintId: string): string {
  const blueprintTokens = blueprintId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (blueprintTokens.length >= 2) return blueprintTokens.map((token) => token[0]).join("");
  const nameTokens = displayName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (nameTokens.length >= 2) return nameTokens.map((token) => token[0]).join("");
  const singleToken = nameTokens[0] ?? blueprintTokens[0] ?? "mod";
  return singleToken.slice(0, 3);
}

function getModuleCurrentPowerDrawKw(module: LocalHabitatModule): number {
  const rawStatus = typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : null;
  const displayedStatus = rawStatus?.toLowerCase();
  const powerDraw = module.runtimeAttributes.powerDrawKw;
  if (!powerDraw || typeof powerDraw !== "object" || Array.isArray(powerDraw)) return 0;
  const lookup = powerDraw as Record<string, unknown>;
  if (rawStatus && typeof lookup[rawStatus] === "number") return lookup[rawStatus] as number;
  if (displayedStatus && typeof lookup[displayedStatus] === "number") return lookup[displayedStatus] as number;
  return 0;
}

function getEffectiveModuleState(module: LocalHabitatModule): ModuleRuntimeStatus | "busy" {
  if (module.runtimeAttributes.constructionJob) {
    return "busy";
  }
  const rawStatus = typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status.toLowerCase() : "";
  if (rawStatus === "online" || rawStatus === "offline" || rawStatus === "idle" || rawStatus === "active" || rawStatus === "damaged") {
    return rawStatus;
  }
  if (rawStatus === "maintenance") {
    return "offline";
  }
  return "offline";
}

function readKeplerEnvironment(): KeplerEnvironment {
  const baseUrl = normalizeBaseUrl(
    process.env.KEPLER_BASE_URL ?? "https://planet.turingguild.com",
  );
  const token = process.env.KEPLER_PLANET_TOKEN;

  if (!token) {
    throw new Error('Missing Kepler token. Set "KEPLER_PLANET_TOKEN" for the backend.');
  }

  return {
    baseUrl,
    token,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
