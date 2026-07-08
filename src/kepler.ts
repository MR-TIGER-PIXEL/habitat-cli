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

export type CompletedConstruction = {
  fabricatorId: string;
  outputModuleId: string;
  blueprintId: string;
};

export type ModulePowerStatusRow = {
  displayName: string;
  declaredStatus: string;
  effectiveState: ModuleRuntimeStatus | "busy";
  currentPowerDrawKw: number;
};

export type ConstructionMaterialMap = Record<string, number>;
export type LocalInventoryEntry = {
  resourceType: string;
  quantity: number;
};

export type ConstructionPlan = {
  blueprint: StoredBlueprint;
  requiredFacility: {
    exists: boolean;
    moduleId: string | null;
    blueprintId: string | null;
  };
  fabricator: {
    available: boolean;
    moduleId: string | null;
    status: string | null;
  };
  supplyCache: {
    online: boolean;
    moduleId: string | null;
    status: string | null;
  };
  prerequisites: {
    met: boolean;
    required: string[];
    missing: string[];
  };
  inventory: {
    sufficient: boolean;
    available: ConstructionMaterialMap;
    shortfalls: Array<{
      resourceType: string;
      need: number;
      have: number;
    }>;
  };
  wouldCreateModule: {
    blueprintId: string;
    displayName: string;
  };
  resourcesToSpend: ConstructionMaterialMap;
  canStart: boolean;
  blockingReasons: string[];
};

export type StartedConstruction = {
  blueprintId: string;
  fabricatorId: string;
  outputModuleId: string;
  buildTicks: number;
  remainingBuildTicks: number;
  jobId: string;
};

export type ActiveConstructionJob = {
  fabricatorId: string;
  fabricatorAlias: string;
  blueprintId: string;
  outputModuleId: string;
  buildTicks: number;
  remainingTicks: number;
};

export type CanceledConstruction = {
  fabricatorId: string;
  fabricatorAlias: string;
};

const DEFAULT_BASE_URL = "https://planet.turingguild.com";
const HABITAT_DIRECTORY = ".habitat";
const REGISTRATION_FILE = "registration.json";
const MODULES_FILE = "modules.json";
const BLUEPRINTS_FILE = "blueprints.json";
const INVENTORY_FILE = "inventory.json";
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
  completedConstructions: CompletedConstruction[];
} {
  requireStoredRegistration(config.cwd);

  if (!Number.isInteger(count) || count <= 0) {
    throw new CliError("Invalid tick count. Use a positive integer.");
  }

  const modules = readStoredModules(config.cwd);
  const state = readTickState(config.cwd);
  const startTick = state.currentTick;
  let totalEnergyUsedKwh = 0;
  const completedConstructions: CompletedConstruction[] = [];

  for (let tick = 0; tick < count; tick += 1) {
    const tickEnergyUsedKwh = modules.reduce(
      (sum, module) => sum + getModuleCurrentPowerDrawKw(module) / 3600,
      0,
    );

    drainBatteries(modules, tickEnergyUsedKwh);
    if (hasUsablePower(modules)) {
      completedConstructions.push(...advanceConstructionJobs(modules));
    }
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
    completedConstructions,
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
    const declaredStatus =
      typeof module.runtimeAttributes.status === "string"
        ? module.runtimeAttributes.status
        : "(unset)";
    const effectiveState = getEffectiveModuleState(module);
    const currentPowerDrawKw = getModuleCurrentPowerDrawKw(module);

    return {
      displayName: module.displayName,
      declaredStatus,
      effectiveState,
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

export function planConstruction(config: CliConfig, blueprintId: string): ConstructionPlan {
  requireStoredRegistration(config.cwd);
  const blueprints = readStoredBlueprints(config.cwd);
  const blueprint = blueprints[blueprintId];

  if (!blueprint) {
    throw new CliError(`Blueprint "${blueprintId}" was not found in local habitat blueprints.`);
  }

  return buildConstructionPlan(config.cwd, blueprint);
}

export async function startConstruction(
  config: CliConfig,
  blueprintId: string,
): Promise<StartedConstruction> {
  requireStoredRegistration(config.cwd);
  const blueprint = await getOfficialBlueprint(config, blueprintId);
  const plan = buildConstructionPlan(config.cwd, blueprint);

  if (!plan.canStart) {
    throw new CliError(plan.blockingReasons[0] ?? "Construction cannot start.");
  }

  const modules = readStoredModules(config.cwd);
  const inventory = readStoredInventory(config.cwd);
  const fabricator = modules.find((module) => module.id === plan.fabricator.moduleId);

  if (!fabricator) {
    throw new CliError("Construction fabricator disappeared before the job could be created.");
  }

  for (const [resourceType, amount] of Object.entries(plan.resourcesToSpend)) {
    inventory[resourceType] = (inventory[resourceType] ?? 0) - amount;
  }

  const outputModuleId = generateOutputModuleId(modules, blueprint.blueprintId);
  const jobId = generateConstructionJobId(modules, blueprint.blueprintId);

  fabricator.runtimeAttributes.status = "active";
  fabricator.runtimeAttributes.constructionJobId = jobId;
  fabricator.runtimeAttributes.constructionJob = {
    id: jobId,
    blueprintId: blueprint.blueprintId,
    outputModuleId,
    buildTicks: blueprint.buildTicks,
    remainingBuildTicks: blueprint.buildTicks,
    futureDisplayName: blueprint.displayName,
    futureRuntimeAttributes:
      blueprint.runtimeAttributes && typeof blueprint.runtimeAttributes === "object"
        ? blueprint.runtimeAttributes
        : {},
    futureCapabilities: Array.isArray(blueprint.capabilities) ? blueprint.capabilities : [],
  };

  writeStoredInventory(config.cwd, inventory);
  writeStoredModules(config.cwd, modules);

  return {
    blueprintId: blueprint.blueprintId,
    fabricatorId: fabricator.id,
    outputModuleId,
    buildTicks: blueprint.buildTicks,
    remainingBuildTicks: blueprint.buildTicks,
    jobId,
  };
}

export function addInventoryResource(
  config: CliConfig,
  resourceType: string,
  quantity: number,
): LocalInventoryEntry {
  requireStoredRegistration(config.cwd);

  if (!resourceType.trim()) {
    throw new CliError("Invalid resource type. Use a non-empty resource type string.");
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new CliError(`Invalid quantity "${quantity}". Use a positive integer.`);
  }

  const inventory = readStoredInventory(config.cwd);
  inventory[resourceType] = (inventory[resourceType] ?? 0) + quantity;
  writeStoredInventory(config.cwd, inventory);

  return {
    resourceType,
    quantity: inventory[resourceType],
  };
}

export function listInventory(config: CliConfig): LocalInventoryEntry[] {
  requireStoredRegistration(config.cwd);

  return Object.entries(readStoredInventory(config.cwd))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceType, quantity]) => ({
      resourceType,
      quantity,
    }));
}

export function listActiveConstructionJobs(config: CliConfig): ActiveConstructionJob[] {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);

  return modules
    .flatMap((module) => {
      const job = module.runtimeAttributes.constructionJob;
      if (!job || typeof job !== "object" || Array.isArray(job)) {
        return [];
      }

      const record = job as Record<string, unknown>;
      const blueprintId = record.blueprintId;
      const outputModuleId = record.outputModuleId;
      const buildTicks = record.buildTicks;
      const remainingTicks = record.remainingBuildTicks;

      if (
        typeof blueprintId !== "string"
        || typeof outputModuleId !== "string"
        || typeof buildTicks !== "number"
        || typeof remainingTicks !== "number"
      ) {
        return [];
      }

      return [{
        fabricatorId: module.id,
        fabricatorAlias: getModuleAlias(module, modules),
        blueprintId,
        outputModuleId,
        buildTicks,
        remainingTicks,
      }];
    });
}

export function cancelConstructionJob(
  config: CliConfig,
  moduleReference: string,
): CanceledConstruction {
  requireStoredRegistration(config.cwd);
  const modules = readStoredModules(config.cwd);
  const module = resolveModuleReferenceFromModules(modules, moduleReference);

  const job = module.runtimeAttributes.constructionJob;
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new CliError(`Module "${moduleReference}" does not have an active construction job.`);
  }

  const alias = getModuleAlias(module, modules);
  delete module.runtimeAttributes.constructionJob;
  delete module.runtimeAttributes.constructionJobId;
  module.runtimeAttributes.status = "idle";
  writeStoredModules(config.cwd, modules);

  return {
    fabricatorId: module.id,
    fabricatorAlias: alias,
  };
}

function buildConstructionPlan(cwd: string, blueprint: StoredBlueprint): ConstructionPlan {
  const modules = readStoredModules(cwd);
  const inventory = readStoredInventory(cwd);

  const resourcesToSpend = getBlueprintInputResources(blueprint);
  const requiredFacilityBlueprintId = getRequiredFacilityBlueprintId(blueprint);
  const facilityModule =
    requiredFacilityBlueprintId === null
      ? null
      : modules.find((module) => module.blueprintId === requiredFacilityBlueprintId) ?? null;
  const facilityStatus = facilityModule ? getDisplayedModuleStatus(facilityModule) : null;
  const facilityBusy = facilityModule
    ? Boolean(
      facilityModule.runtimeAttributes.constructionJobId ?? facilityModule.runtimeAttributes.busy,
    )
    : false;

  const supplyCacheModule =
    modules.find((module) =>
      module.blueprintId === "supply-cache"
      || module.capabilities.includes("storage")
      || module.capabilities.includes("logistics")
    ) ?? null;
  const supplyCacheStatus = supplyCacheModule ? getDisplayedModuleStatus(supplyCacheModule) : null;
  const supplyCacheOnline =
    supplyCacheModule !== null
    && (supplyCacheStatus === "online" || supplyCacheStatus === "idle" || supplyCacheStatus === "active");

  const requiredPrerequisites = Array.isArray(blueprint.prerequisites) ? blueprint.prerequisites : [];
  const missingPrerequisites = requiredPrerequisites.filter((requirement) =>
    !modules.some((module) =>
      module.blueprintId === requirement || module.capabilities.includes(requirement)
    )
  );

  const inventoryAvailable = Object.fromEntries(
    Object.keys(resourcesToSpend).map((resourceType) => [resourceType, inventory[resourceType] ?? 0]),
  );
  const shortfalls = Object.entries(resourcesToSpend)
    .map(([resourceType, need]) => ({
      resourceType,
      need,
      have: inventory[resourceType] ?? 0,
    }))
    .filter((entry) => entry.have < entry.need);

  const blockingReasons: string[] = [];

  if (blueprint.status !== "published") {
    blockingReasons.push("blueprint is not published");
  }

  if (blueprint.output.itemType !== "module") {
    blockingReasons.push("blueprint does not create a module");
  }

  if (requiredFacilityBlueprintId && !facilityModule) {
    blockingReasons.push(`required construction facility "${requiredFacilityBlueprintId}" does not exist`);
  }

  if (facilityModule && facilityBusy) {
    blockingReasons.push("required construction facility is busy");
  }

  if (
    facilityModule
    && !facilityBusy
    && facilityStatus !== "online"
    && facilityStatus !== "idle"
    && facilityStatus !== "active"
  ) {
    blockingReasons.push("required construction facility is offline");
  }

  if (!supplyCacheModule) {
    blockingReasons.push("supply cache is missing");
  } else if (!supplyCacheOnline) {
    blockingReasons.push("supply cache is offline");
  }

  if (missingPrerequisites.length > 0) {
    blockingReasons.push(`missing prerequisites: ${missingPrerequisites.join(", ")}`);
  }

  for (const shortfall of shortfalls) {
    blockingReasons.push(
      `inventory shortfall: ${shortfall.resourceType} need=${shortfall.need} have=${shortfall.have}`,
    );
  }

  if (!hasUsablePower(modules)) {
    blockingReasons.push(
      "construction cannot start or advance until a usable battery or power source is online",
    );
  }

  return {
    blueprint,
    requiredFacility: {
      exists: facilityModule !== null,
      moduleId: facilityModule?.id ?? null,
      blueprintId: requiredFacilityBlueprintId,
    },
    fabricator: {
      available:
        facilityModule !== null
        && !facilityBusy
        && (facilityStatus === "online" || facilityStatus === "idle" || facilityStatus === "active"),
      moduleId: facilityModule?.id ?? null,
      status: facilityStatus,
    },
    supplyCache: {
      online: supplyCacheOnline,
      moduleId: supplyCacheModule?.id ?? null,
      status: supplyCacheStatus,
    },
    prerequisites: {
      met: missingPrerequisites.length === 0,
      required: requiredPrerequisites,
      missing: missingPrerequisites,
    },
    inventory: {
      sufficient: shortfalls.length === 0,
      available: inventoryAvailable,
      shortfalls,
    },
    wouldCreateModule: {
      blueprintId: blueprint.blueprintId,
      displayName: blueprint.displayName,
    },
    resourcesToSpend,
    canStart: blockingReasons.length === 0,
    blockingReasons,
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

  const generatedNameMatch = modules.find((item) => getModuleGeneratedName(item, modules) === reference);
  if (generatedNameMatch) {
    return generatedNameMatch;
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

function getModuleGeneratedName(module: LocalHabitatModule, modules: LocalHabitatModule[]): string {
  const matchingModules = modules.filter((item) => item.blueprintId === module.blueprintId);
  const position = matchingModules.findIndex((item) => item.id === module.id);
  return `${module.blueprintId}-${position + 1}`;
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

function getInventoryPath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), INVENTORY_FILE);
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

function readStoredInventory(cwd: string): ConstructionMaterialMap {
  const inventoryPath = getInventoryPath(cwd);
  if (!existsSync(inventoryPath)) {
    return {};
  }

  return JSON.parse(readFileSync(inventoryPath, "utf8")) as ConstructionMaterialMap;
}

function writeStoredInventory(cwd: string, inventory: ConstructionMaterialMap): void {
  ensureHabitatDirectory(cwd);
  writeFileSync(getInventoryPath(cwd), `${JSON.stringify(inventory, null, 2)}\n`);
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
    getInventoryPath(cwd),
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

function getBlueprintInputResources(blueprint: StoredBlueprint): ConstructionMaterialMap {
  if (!blueprint.inputs || typeof blueprint.inputs !== "object" || Array.isArray(blueprint.inputs)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(blueprint.inputs).filter(([, amount]) => typeof amount === "number"),
  );
}

function getRequiredFacilityBlueprintId(blueprint: StoredBlueprint): string | null {
  const moduleType = blueprint.requiredFacility?.moduleType;
  return typeof moduleType === "string" && moduleType.length > 0 ? moduleType : null;
}

function hasUsablePower(modules: LocalHabitatModule[]): boolean {
  return modules.some((module) =>
    isBatteryModule(module)
    && getDisplayedModuleStatus(module) !== "offline"
    && getBatteryEnergy(module) > 0
  );
}

function generateOutputModuleId(modules: LocalHabitatModule[], blueprintId: string): string {
  const prefix = `module-${blueprintId}-`;
  const nextIndex =
    modules.filter((module) => module.id.startsWith(prefix)).length + 1;
  return `${prefix}${nextIndex}`;
}

function generateConstructionJobId(modules: LocalHabitatModule[], blueprintId: string): string {
  const prefix = `job-${blueprintId}-`;
  const nextIndex = modules.reduce((count, module) => {
    const jobId = module.runtimeAttributes.constructionJobId;
    return typeof jobId === "string" && jobId.startsWith(prefix) ? count + 1 : count;
  }, 1);

  return `${prefix}${nextIndex}`;
}

function advanceConstructionJobs(modules: LocalHabitatModule[]): CompletedConstruction[] {
  const completed: CompletedConstruction[] = [];

  for (const module of modules) {
    const job = module.runtimeAttributes.constructionJob;
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      continue;
    }

    const record = job as Record<string, unknown>;
    const remainingBuildTicks = record.remainingBuildTicks;

    if (typeof remainingBuildTicks !== "number" || remainingBuildTicks <= 0) {
      continue;
    }

    record.remainingBuildTicks = remainingBuildTicks - 1;

    if (record.remainingBuildTicks !== 0) {
      continue;
    }

    const outputModule = createCompletedModuleFromJob(record);
    modules.push(outputModule);
    delete module.runtimeAttributes.constructionJob;
    delete module.runtimeAttributes.constructionJobId;
    module.runtimeAttributes.status = "idle";

    completed.push({
      fabricatorId: module.id,
      outputModuleId: outputModule.id,
      blueprintId: outputModule.blueprintId,
    });
  }

  return completed;
}

function createCompletedModuleFromJob(job: Record<string, unknown>): LocalHabitatModule {
  const outputModuleId = job.outputModuleId;
  const blueprintId = job.blueprintId;
  const futureDisplayName = job.futureDisplayName;
  const futureRuntimeAttributes = job.futureRuntimeAttributes;
  const futureCapabilities = job.futureCapabilities;

  if (
    typeof outputModuleId !== "string"
    || typeof blueprintId !== "string"
    || typeof futureDisplayName !== "string"
  ) {
    throw new CliError("Stored construction job is missing required module details.");
  }

  return {
    id: outputModuleId,
    blueprintId,
    displayName: futureDisplayName,
    connectedTo: [],
    runtimeAttributes:
      futureRuntimeAttributes && typeof futureRuntimeAttributes === "object" && !Array.isArray(futureRuntimeAttributes)
        ? futureRuntimeAttributes as RuntimeAttributes
        : {},
    capabilities: Array.isArray(futureCapabilities)
      ? futureCapabilities.filter((value): value is string => typeof value === "string")
      : [],
    source: "local",
  };
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

function getEffectiveModuleState(
  module: LocalHabitatModule,
): ModuleRuntimeStatus | "busy" {
  if (module.runtimeAttributes.constructionJob) {
    return "busy";
  }

  return getDisplayedModuleStatus(module);
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
