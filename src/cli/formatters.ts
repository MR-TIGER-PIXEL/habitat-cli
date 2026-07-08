import { formatModuleListEntry, type LocalHabitatModule, type OfficialResource, type StoredBlueprint } from "../kepler";

export function printRegistrationSuccess(result: {
  registration: {
    displayName: string;
    habitatId: string;
    habitatUuid: string;
  };
  modules: Array<unknown>;
}): void {
  console.log(`Registered habitat "${result.registration.displayName}".`);
  console.log(`habitatId: ${result.registration.habitatId}`);
  console.log(`habitatUuid: ${result.registration.habitatUuid}`);
  console.log(`moduleCount: ${result.modules.length}`);
  console.log("saved: .habitat/registration.json");
  console.log("saved: .habitat/modules.json");
  console.log("saved: .habitat/blueprints.json");
}

export function printRegistrationStatus(result: {
  registration: {
    displayName: string;
    habitatId: string;
    habitatUuid: string;
    baseUrl: string;
  };
  habitat: {
    habitatSlug: string;
    status: string;
    catalogVersion: string;
    lastSeenAt: string | null;
  };
  moduleCount: number;
}, currentTick: number): void {
  console.log(`displayName: ${result.registration.displayName}`);
  console.log(`habitatId: ${result.registration.habitatId}`);
  console.log(`habitatUuid: ${result.registration.habitatUuid}`);
  console.log(`baseUrl: ${result.registration.baseUrl}`);
  console.log(`moduleCount: ${result.moduleCount}`);
  console.log(`currentTick: ${currentTick}`);
  console.log(`habitatSlug: ${result.habitat.habitatSlug}`);
  console.log(`status: ${result.habitat.status}`);
  console.log(`catalogVersion: ${result.habitat.catalogVersion}`);
  console.log(`lastSeenAt: ${result.habitat.lastSeenAt ?? "(never)"}`);
}

export function printTickResult(result: {
  startTick: number;
  endTick: number;
  totalEnergyUsedKwh: number;
  batteries: Array<{
    alias: string;
    id: string;
    currentEnergyKwh: number;
  }>;
}, count: number): void {
  console.log(`startTick: ${result.startTick}`);
  console.log(`endTick: ${result.endTick}`);
  console.log(`ticksAdvanced: ${count}`);
  console.log(`totalEnergyUsedKwh: ${result.totalEnergyUsedKwh}`);

  if (result.batteries.length === 0) {
    console.log("batteries: (none)");
    return;
  }

  console.log("batteries:");
  for (const battery of result.batteries) {
    console.log(`- ${battery.alias} | id=${battery.id} | currentEnergyKwh=${battery.currentEnergyKwh}`);
  }
}

export function printModuleList(modules: LocalHabitatModule[]): void {
  if (modules.length === 0) {
    console.log("No modules found.");
    return;
  }

  for (const module of modules) {
    console.log(formatModuleListEntry(module, modules));
  }
}

export function printModuleStatus(result: {
  rows: Array<{
    displayName: string;
    status: string;
    currentPowerDrawKw: number;
  }>;
  totalCurrentPowerDrawKw: number;
  oneTickEnergyCostKwh: number;
}): void {
  if (result.rows.length === 0) {
    console.log("No modules found.");
    return;
  }

  console.log("Module Name | Runtime State | Current Power Draw (kW)");
  console.log("----------- | ------------- | -----------------------");
  for (const row of result.rows) {
    console.log(`${row.displayName} | ${row.status} | ${row.currentPowerDrawKw}`);
  }
  console.log(`totalCurrentPowerDrawKw: ${result.totalCurrentPowerDrawKw}`);
  console.log(`oneTickEnergyCostKwh: ${result.oneTickEnergyCostKwh}`);
}

export function printModuleDetails(
  module: LocalHabitatModule,
  modules: LocalHabitatModule[],
  blueprint: StoredBlueprint | null,
): void {
  console.log(`alias: ${formatModuleListEntry(module, modules).split(" | ")[0]}`);
  console.log(`id: ${module.id}`);
  console.log(`blueprintId: ${module.blueprintId}`);
  console.log(`displayName: ${module.displayName}`);
  console.log(`source: ${module.source}`);
  console.log(`connectedTo: ${JSON.stringify(module.connectedTo)}`);
  console.log(`capabilities: ${JSON.stringify(module.capabilities)}`);
  console.log(`runtimeAttributes: ${JSON.stringify(module.runtimeAttributes)}`);

  if (!blueprint) {
    console.log("officialBlueprint: (none)");
    return;
  }

  console.log("officialBlueprint:");
  console.log(`  blueprintId: ${blueprint.blueprintId}`);
  console.log(`  displayName: ${blueprint.displayName}`);
  console.log(`  status: ${blueprint.status}`);
}

export function printBlueprintList(result: {
  catalogVersion: string;
  blueprints: StoredBlueprint[];
}): void {
  if (result.blueprints.length === 0) {
    console.log("No blueprints found.");
    return;
  }

  console.log("Blueprint ID | Display Name | Status | Build Ticks");
  console.log("------------ | ------------ | ------ | -----------");
  for (const blueprint of result.blueprints) {
    console.log(
      `${blueprint.blueprintId} | ${blueprint.displayName} | ${blueprint.status} | ${blueprint.buildTicks}`,
    );
  }
  console.log(`catalogVersion: ${result.catalogVersion}`);
}

export function printBlueprintDetails(blueprint: StoredBlueprint): void {
  console.log(`blueprintId: ${blueprint.blueprintId}`);
  console.log(`displayName: ${blueprint.displayName}`);
  console.log(`status: ${blueprint.status}`);
  console.log(`buildTicks: ${blueprint.buildTicks}`);
  console.log(`repeatable: ${blueprint.repeatable ? "yes" : "no"}`);
  console.log(`description: ${blueprint.description}`);
  console.log(`inputs: ${JSON.stringify(blueprint.inputs)}`);
  console.log(`output: ${JSON.stringify(blueprint.output)}`);

  if (blueprint.productionCost) {
    console.log(`productionCost: ${JSON.stringify(blueprint.productionCost)}`);
  }

  if (blueprint.requiredFacility) {
    console.log(`requiredFacility: ${JSON.stringify(blueprint.requiredFacility)}`);
  }

  if (blueprint.prerequisites?.length) {
    console.log(`prerequisites: ${JSON.stringify(blueprint.prerequisites)}`);
  }

  if (blueprint.unlocks?.length) {
    console.log(`unlocks: ${JSON.stringify(blueprint.unlocks)}`);
  }

  if (blueprint.capabilities?.length) {
    console.log(`capabilities: ${JSON.stringify(blueprint.capabilities)}`);
  }

  if (blueprint.runtimeAttributes) {
    console.log(`runtimeAttributes: ${JSON.stringify(blueprint.runtimeAttributes)}`);
  }
}

export function printResourceList(result: {
  catalogVersion: string;
  resources: OfficialResource[];
}): void {
  if (result.resources.length === 0) {
    console.log("No resources found.");
    return;
  }

  console.log("Resource Type | Display Name | Kind | Rarity | Unit");
  console.log("------------- | ------------ | ---- | ------ | ----");
  for (const resource of result.resources) {
    console.log(
      `${resource.resourceType} | ${resource.displayName} | ${resource.kind} | ${resource.rarity} | ${resource.unit ?? "(none)"}`,
    );
  }
  console.log(`catalogVersion: ${result.catalogVersion}`);
  console.log("resource catalog: possible resource types in the Kepler world");
  console.log("local inventory: resources your habitat owns, handled later");
  console.log("blueprint requirements: resources or modules needed to build something later");
}

export function printUnregisterSuccess(displayName: string): void {
  console.log(`Unregistered habitat "${displayName}".`);
  console.log("removed: .habitat/registration.json");
  console.log("removed: .habitat/modules.json");
  console.log("removed: .habitat/blueprints.json");
}
