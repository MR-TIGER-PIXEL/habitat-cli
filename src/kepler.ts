import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

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

export type SolarIrradiance = {
  irradianceWPerM2: number;
  condition: string;
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
  energyStorageKwh: number;
};

export type CompletedConstruction = {
  fabricatorId: string;
  outputModuleId: string;
  blueprintId: string;
};

export type SolarChargingSummary = {
  generatedKwh: number;
  chargedKwh: number;
  reason: string;
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
const HABITAT_DATABASE = "habitat.sqlite";
const BLUEPRINTS_FILE = "blueprints.json";

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

export async function getSolarIrradiance(config: CliConfig): Promise<SolarIrradiance> {
  return requestJson<SolarIrradiance>(config, "/world/solar-irradiance", {
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
  const database = openHabitatDatabase(cwd);
  const row = database.query<{ current_tick: number }, []>(
    "SELECT current_tick FROM tick_state WHERE id = 1",
  ).get();
  return row ? { currentTick: row.current_tick } : { currentTick: 0 };
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
  solarIrradiance?: SolarIrradiance,
): {
  startTick: number;
  endTick: number;
  totalEnergyUsedKwh: number;
  solarCharging: SolarChargingSummary;
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
  let totalSolarGeneratedKwh = 0;
  let totalSolarChargedKwh = 0;
  const completedConstructions: CompletedConstruction[] = [];

  for (let tick = 0; tick < count; tick += 1) {
    const tickLoadKw = modules.reduce((sum, module) => sum + getModuleCurrentPowerDrawKw(module), 0);
    const tickEnergyUsedKwh = tickLoadKw / 3600;
    // One tick is one simulated second, so kW values become kWh/tick by dividing by 3600.
    const generatedKwhPerTick = getGeneratedSolarEnergyKwhPerTick(modules, solarIrradiance);

    drainBatteries(modules, tickEnergyUsedKwh);
    const chargedKwh = chargeBatteries(modules, generatedKwhPerTick);
    if (hasUsablePower(modules, solarIrradiance)) {
      completedConstructions.push(...advanceConstructionJobs(modules));
    }
    totalEnergyUsedKwh += tickEnergyUsedKwh;
    totalSolarGeneratedKwh += generatedKwhPerTick;
    totalSolarChargedKwh += chargedKwh;
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
      energyStorageKwh: getBatteryCapacity(module),
    }));

  return {
    startTick,
    endTick: state.currentTick,
    totalEnergyUsedKwh,
    solarCharging: {
      generatedKwh: totalSolarGeneratedKwh,
      chargedKwh: totalSolarChargedKwh,
      reason: getSolarChargingReason(
        modules,
        solarIrradiance,
        totalSolarGeneratedKwh,
        totalSolarChargedKwh,
      ),
    },
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

function getDatabasePath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), HABITAT_DATABASE);
}

function getBlueprintsPath(cwd: string): string {
  return path.join(getHabitatDirectory(cwd), BLUEPRINTS_FILE);
}

function ensureHabitatDirectory(cwd: string): void {
  const habitatDirectory = getHabitatDirectory(cwd);
  if (!existsSync(habitatDirectory)) {
    mkdirSync(habitatDirectory, { recursive: true });
  }
}

function openHabitatDatabase(cwd: string): Database {
  ensureHabitatDirectory(cwd);
  const database = new Database(getDatabasePath(cwd));
  database.exec(`
    CREATE TABLE IF NOT EXISTS registration (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL,
      habitat_uuid TEXT NOT NULL,
      habitat_id TEXT NOT NULL,
      base_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      module_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      resource_type TEXT PRIMARY KEY,
      quantity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tick_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_tick INTEGER NOT NULL
    );
  `);
  return database;
}

function readStoredRegistration(cwd: string): RegistrationRecord | null {
  const database = openHabitatDatabase(cwd);
  const row = database
    .query<RegistrationRecord, []>(
      "SELECT display_name AS displayName, habitat_uuid AS habitatUuid, habitat_id AS habitatId, base_url AS baseUrl FROM registration WHERE id = 1",
    )
    .get();
  return row ?? null;
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
  const database = openHabitatDatabase(cwd);
  database
    .query(
      `INSERT INTO registration (id, display_name, habitat_uuid, habitat_id, base_url)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         habitat_uuid = excluded.habitat_uuid,
         habitat_id = excluded.habitat_id,
         base_url = excluded.base_url`,
    )
    .run(registration.displayName, registration.habitatUuid, registration.habitatId, registration.baseUrl);
}

function readStoredModules(cwd: string): LocalHabitatModule[] {
  const database = openHabitatDatabase(cwd);
  const rows = database.query<{ module_json: string }, []>(
    "SELECT module_json FROM modules ORDER BY rowid",
  ).all();
  return rows.map((row) => JSON.parse(row.module_json) as LocalHabitatModule);
}

function writeStoredModules(cwd: string, modules: LocalHabitatModule[]): void {
  ensureHabitatDirectory(cwd);
  const database = openHabitatDatabase(cwd);
  const transaction = database.transaction((items: LocalHabitatModule[]) => {
    database.query("DELETE FROM modules").run();
    const insert = database.query("INSERT INTO modules (id, module_json) VALUES (?, ?)");
    for (const module of items) {
      insert.run(module.id, JSON.stringify(module));
    }
  });
  transaction(modules);
}

function readStoredBlueprints(cwd: string): Record<string, StoredBlueprint> {
  const blueprintsPath = getBlueprintsPath(cwd);
  if (!existsSync(blueprintsPath)) {
    return {};
  }

  return JSON.parse(readFileSync(blueprintsPath, "utf8")) as Record<string, StoredBlueprint>;
}

function readStoredInventory(cwd: string): ConstructionMaterialMap {
  const database = openHabitatDatabase(cwd);
  const rows = database.query<{ resource_type: string; quantity: number }, []>(
    "SELECT resource_type, quantity FROM inventory ORDER BY resource_type",
  ).all();
  return Object.fromEntries(rows.map((row) => [row.resource_type, row.quantity]));
}

function writeStoredInventory(cwd: string, inventory: ConstructionMaterialMap): void {
  ensureHabitatDirectory(cwd);
  const database = openHabitatDatabase(cwd);
  const transaction = database.transaction((items: ConstructionMaterialMap) => {
    database.query("DELETE FROM inventory").run();
    const insert = database.query("INSERT INTO inventory (resource_type, quantity) VALUES (?, ?)");
    for (const [resourceType, quantity] of Object.entries(items)) {
      insert.run(resourceType, quantity);
    }
  });
  transaction(inventory);
}

function writeStoredBlueprints(cwd: string, blueprints: Record<string, StoredBlueprint>): void {
  ensureHabitatDirectory(cwd);
  writeFileSync(getBlueprintsPath(cwd), `${JSON.stringify(blueprints, null, 2)}\n`);
}

function writeTickState(cwd: string, state: TickState): void {
  ensureHabitatDirectory(cwd);
  const database = openHabitatDatabase(cwd);
  database
    .query(
      `INSERT INTO tick_state (id, current_tick)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET
         current_tick = excluded.current_tick`,
    )
    .run(state.currentTick);
}

function deleteStoredState(cwd: string): void {
  for (const filePath of [
    getDatabasePath(cwd),
    getBlueprintsPath(cwd),
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

function getBatteryCapacity(module: LocalHabitatModule): number {
  return typeof module.runtimeAttributes.energyStorageKwh === "number"
    ? module.runtimeAttributes.energyStorageKwh
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

function chargeBatteries(modules: LocalHabitatModule[], generatedKwhPerTick: number): number {
  if (generatedKwhPerTick <= 0) {
    return 0;
  }

  const batteries = modules.filter((module) =>
    isBatteryModule(module) && getDisplayedModuleStatus(module) !== "offline"
  );

  const totalRemainingCapacity = batteries.reduce((sum, battery) => {
    const remainingCapacity = Math.max(0, getBatteryCapacity(battery) - getBatteryEnergy(battery));
    return sum + remainingCapacity;
  }, 0);

  if (totalRemainingCapacity <= 0) {
    return 0;
  }

  let totalChargedKwh = 0;
  for (const battery of batteries) {
    const currentEnergy = getBatteryEnergy(battery);
    const energyStorageKwh = getBatteryCapacity(battery);
    const remainingCapacity = Math.max(0, energyStorageKwh - currentEnergy);
    const share = remainingCapacity / totalRemainingCapacity;
    const charged = generatedKwhPerTick * share;
    const newEnergy = Math.min(
      energyStorageKwh,
      currentEnergy + charged,
    );
    battery.runtimeAttributes.currentEnergyKwh = newEnergy;
    totalChargedKwh += newEnergy - currentEnergy;
  }

  return totalChargedKwh;
}

function getBlueprintInputResources(blueprint: StoredBlueprint): ConstructionMaterialMap {
  if (!blueprint.inputs || typeof blueprint.inputs !== "object" || Array.isArray(blueprint.inputs)) {
    return {};
  }

  const numericEntries = Object.entries(blueprint.inputs).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );

  return Object.fromEntries(numericEntries);
}

function getRequiredFacilityBlueprintId(blueprint: StoredBlueprint): string | null {
  const moduleType = blueprint.requiredFacility?.moduleType;
  return typeof moduleType === "string" && moduleType.length > 0 ? moduleType : null;
}

function hasUsablePower(modules: LocalHabitatModule[], solarIrradiance?: SolarIrradiance): boolean {
  return modules.some((module) =>
    isBatteryModule(module)
    && getDisplayedModuleStatus(module) !== "offline"
    && getBatteryEnergy(module) > 0
  ) || getTotalSolarGenerationKw(modules, solarIrradiance) > 0;
}

function getSolarChargingReason(
  modules: LocalHabitatModule[],
  solarIrradiance: SolarIrradiance | undefined,
  generatedKwh: number,
  chargedKwh: number,
): string {
  const chargingToleranceKwh = 1e-12;
  const irradianceWPerM2 =
    solarIrradiance && typeof solarIrradiance.irradianceWPerM2 === "number"
      ? solarIrradiance.irradianceWPerM2
      : 0;

  if (irradianceWPerM2 <= 0) {
    return "no solar irradiance";
  }

  if (!hasOnlineSolarGenerationModule(modules)) {
    return "no online solar generation modules";
  }

  if (!hasOnlineBatteryModule(modules)) {
    return "no online battery modules";
  }

  // Treat tiny floating-point differences as equal so successful charging
  // doesn't get mislabeled as a partial-capacity edge case.
  if (generatedKwh > 0 && generatedKwh - chargedKwh > chargingToleranceKwh) {
    return "battery capacity reached";
  }

  if (chargedKwh > 0) {
    return "charged online batteries";
  }

  return "no solar generation";
}

function hasOnlineSolarGenerationModule(modules: LocalHabitatModule[]): boolean {
  return modules.some((module) =>
    module.capabilities.includes("power-generation")
    && getDisplayedModuleStatus(module) !== "offline"
    && typeof module.runtimeAttributes.powerGenerationKw === "number"
    && module.runtimeAttributes.powerGenerationKw > 0
  );
}

function hasOnlineBatteryModule(modules: LocalHabitatModule[]): boolean {
  return modules.some((module) =>
    isBatteryModule(module) && getDisplayedModuleStatus(module) !== "offline"
  );
}

function getTotalSolarGenerationKw(
  modules: LocalHabitatModule[],
  solarIrradiance?: SolarIrradiance,
): number {
  return getGeneratedSolarEnergyKwhPerTick(modules, solarIrradiance) * 3600;
}

function getGeneratedSolarEnergyKwhPerTick(
  modules: LocalHabitatModule[],
  solarIrradiance?: SolarIrradiance,
): number {
  const irradianceWPerM2 =
    solarIrradiance && typeof solarIrradiance.irradianceWPerM2 === "number"
      ? solarIrradiance.irradianceWPerM2
      : 0;

  if (irradianceWPerM2 <= 0) {
    return 0;
  }

  const solarMultiplier = irradianceWPerM2 / 900;
  const solarEfficiency = 0.5;

  return modules.reduce((sum, module) => {
    if (
      !module.capabilities.includes("power-generation")
      || getDisplayedModuleStatus(module) === "offline"
    ) {
      return sum;
    }

    const peakGenerationKw = module.runtimeAttributes.powerGenerationKw;
    if (typeof peakGenerationKw !== "number" || peakGenerationKw <= 0) {
      return sum;
    }

    // First-version lab rule:
    //   solarMultiplier = irradianceWPerM2 / 900
    //   generatedKwhPerTick = powerGenerationKw * solarMultiplier * 0.5 / 3600
    // This keeps the math simple: lower irradiance means less charge, zero irradiance means no charge,
    // and the result stays in the same per-second tick units used elsewhere in the CLI.
    return sum + Math.max(0, (peakGenerationKw * solarMultiplier * solarEfficiency) / 3600);
  }, 0);
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
