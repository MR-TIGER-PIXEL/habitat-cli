import {
  type ActiveConstructionJob,
  formatModuleListEntry,
  type ConstructionPlan,
  type LocalInventoryEntry,
  type LocalHabitatModule,
  type OfficialResource,
  type SolarIrradiance,
  type StartedConstruction,
  type StoredBlueprint,
} from "../kepler";

function printAlignedTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );

  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ").trimEnd();

  console.log(formatRow(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function formatKwh(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, "");
}

function formatKw(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, "");
}

function formatBatteryCharge(currentEnergyKwh: number, energyStorageKwh: number): string {
  const percentFull =
    energyStorageKwh > 0 ? ((currentEnergyKwh / energyStorageKwh) * 100).toFixed(1) : "0.0";
  return `${formatKwh(currentEnergyKwh)} / ${formatKwh(energyStorageKwh)} kWh (${percentFull}% full)`;
}

function describeSolarChargingReason(reason: string): string {
  switch (reason) {
    case "charged online batteries":
      return "Solar panels charged the online batteries.";
    case "battery capacity reached":
      return "The batteries are full, so extra solar power could not be stored.";
    case "no online battery modules":
      return "No online batteries were available to store the solar power.";
    case "no online solar generation modules":
      return "No online solar panels were available to generate power.";
    case "no solar irradiance":
      return "No sunlight reached the habitat, so solar charging could not happen.";
    default:
      return "Solar charging did not happen.";
  }
}

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
  solarCharging: {
    generatedKwh: number;
    chargedKwh: number;
    reason: string;
  };
  batteries: Array<{
    alias: string;
    id: string;
    currentEnergyKwh: number;
    energyStorageKwh: number;
  }>;
  completedConstructions: Array<{
    fabricatorId: string;
    outputModuleId: string;
    blueprintId: string;
  }>;
}, count: number): void {
  console.log(`startTick: ${result.startTick}`);
  console.log(`endTick: ${result.endTick}`);
  console.log(`ticksAdvanced: ${count}`);
  console.log(`totalEnergyUsedKwh: ${result.totalEnergyUsedKwh}`);
  console.log(`solarGeneratedKwh: ${formatKwh(result.solarCharging.generatedKwh)}`);
  console.log(`solarChargedKwh: ${formatKwh(result.solarCharging.chargedKwh)}`);
  console.log(`solarChargingReason: ${result.solarCharging.reason}`);
  console.log(`solarSummary: ${describeSolarChargingReason(result.solarCharging.reason)}`);

  for (const completed of result.completedConstructions) {
    console.log(
      `constructionCompleted: ${completed.outputModuleId} (${completed.blueprintId}) via ${completed.fabricatorId}`,
    );
  }

  if (result.batteries.length === 0) {
    console.log("batteries: (none)");
    return;
  }

  console.log("batteries:");
  for (const battery of result.batteries) {
    console.log(
      `- ${battery.alias} | charge=${formatBatteryCharge(battery.currentEnergyKwh, battery.energyStorageKwh)} | id=${battery.id}`,
    );
  }
}

export function printModuleList(modules: LocalHabitatModule[]): void {
  if (modules.length === 0) {
    console.log("No modules found.");
    return;
  }

  printAlignedTable(
    ["Alias", "Module Name", "Blueprint ID", "Source"],
    modules.map((module) => {
      const [alias, displayName, blueprintId, sourcePart] = formatModuleListEntry(module, modules).split(" | ");
      return [
        alias ?? "",
        displayName ?? "",
        blueprintId ?? "",
        sourcePart?.replace(/^source=/, "") ?? "",
      ];
    }),
  );
}

export function printModuleStatus(result: {
  rows: Array<{
    displayName: string;
    declaredStatus: string;
    effectiveState: string;
    currentPowerDrawKw: number;
  }>;
  totalCurrentPowerDrawKw: number;
  oneTickEnergyCostKwh: number;
}): void {
  if (result.rows.length === 0) {
    console.log("No modules found.");
    return;
  }

  printAlignedTable(
    ["Module Name", "Declared Status", "Effective State", "Current Power Draw (kW)"],
    result.rows.map((row) => [
      row.displayName,
      row.declaredStatus,
      row.effectiveState,
      String(row.currentPowerDrawKw),
    ]),
  );
  console.log(`totalCurrentPowerDrawKw: ${result.totalCurrentPowerDrawKw}`);
  console.log(`oneTickEnergyCostKwh: ${result.oneTickEnergyCostKwh}`);
}

export function printModuleDetails(
  module: LocalHabitatModule,
  modules: LocalHabitatModule[],
  blueprint: StoredBlueprint | null,
): void {
  const alias = formatModuleListEntry(module, modules).split(" | ")[0];
  const declaredStatus =
    typeof module.runtimeAttributes.status === "string"
      ? module.runtimeAttributes.status
      : "(unset)";
  const effectiveState = module.runtimeAttributes.constructionJob ? "busy" : declaredStatus;
  const constructionJob =
    module.runtimeAttributes.constructionJob
    && typeof module.runtimeAttributes.constructionJob === "object"
    && !Array.isArray(module.runtimeAttributes.constructionJob)
      ? module.runtimeAttributes.constructionJob as Record<string, unknown>
      : null;
  const batteryDetailKeys = ["currentEnergyKwh", "energyStorageKwh", "reserveKwh", "maxPowerOutputKw"];
  const completedModuleKeys = [
    "powerGenerationKw",
    "degradedStormGenerationKw",
    "maintenanceHoursPer100Ticks",
    "surfaceAreaM2",
  ];

  console.log(`alias: ${alias}`);
  console.log(`id: ${module.id}`);
  console.log(`blueprintId: ${module.blueprintId}`);
  console.log(`displayName: ${module.displayName}`);
  console.log(`source: ${module.source}`);
  console.log(`declaredStatus: ${declaredStatus}`);
  console.log(`effectiveState: ${effectiveState}`);
  console.log(`connectedTo: ${JSON.stringify(module.connectedTo)}`);
  console.log(`capabilities: ${JSON.stringify(module.capabilities)}`);

  if (constructionJob) {
    console.log("activeConstructionJob:");
    console.log(`  blueprintId: ${String(constructionJob.blueprintId ?? "(unknown)")}`);
    console.log(`  outputModuleId: ${String(constructionJob.outputModuleId ?? "(unknown)")}`);
    console.log(`  buildTicks: ${String(constructionJob.buildTicks ?? "(unknown)")}`);
    console.log(`  remainingTicks: ${String(constructionJob.remainingBuildTicks ?? "(unknown)")}`);
  }

  const batteryDetails = batteryDetailKeys.filter((key) => typeof module.runtimeAttributes[key] === "number");
  if (batteryDetails.length > 0) {
    console.log("battery:");
    if (typeof module.runtimeAttributes.currentEnergyKwh === "number") {
      const currentEnergyKwh = module.runtimeAttributes.currentEnergyKwh;
      const energyStorageKwh =
        typeof module.runtimeAttributes.energyStorageKwh === "number"
          ? module.runtimeAttributes.energyStorageKwh
          : currentEnergyKwh;

      console.log(`  current charge: ${formatBatteryCharge(currentEnergyKwh, energyStorageKwh)}`);
    }
    for (const key of batteryDetails) {
      console.log(`  ${key}: ${String(module.runtimeAttributes[key])}`);
    }
  }

  for (const key of completedModuleKeys) {
    if (typeof module.runtimeAttributes[key] === "number") {
      console.log(`${key}: ${String(module.runtimeAttributes[key])}`);
    }
  }

  if (typeof module.runtimeAttributes.powerGenerationKw === "number") {
    console.log("solar panel:");
    console.log(`  peak generation: ${formatKw(module.runtimeAttributes.powerGenerationKw)} kW`);
    if (typeof module.runtimeAttributes.degradedStormGenerationKw === "number") {
      console.log(
        `  storm generation: ${formatKw(module.runtimeAttributes.degradedStormGenerationKw)} kW`,
      );
    }
    if (typeof module.runtimeAttributes.surfaceAreaM2 === "number") {
      console.log(`  surface area: ${formatKw(module.runtimeAttributes.surfaceAreaM2)} m2`);
    }
    if (
      module.capabilities.includes("power-generation")
      && typeof module.runtimeAttributes.powerGenerationKw === "number"
    ) {
      console.log("  capability: power-generation");
    }
  }

  if (
    declaredStatus === "offline"
    && typeof module.runtimeAttributes.currentEnergyKwh === "number"
  ) {
    console.log("note: this battery is offline, so solar charging will skip it.");
  } else if (declaredStatus === "offline" && typeof module.runtimeAttributes.powerGenerationKw === "number") {
    console.log("note: this solar panel is offline, so it will not generate power right now.");
  }

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

  printAlignedTable(
    ["Blueprint ID", "Display Name", "Status", "Build Ticks"],
    result.blueprints.map((blueprint) => [
      blueprint.blueprintId,
      blueprint.displayName,
      blueprint.status,
      String(blueprint.buildTicks),
    ]),
  );
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

export function printConstructionPlan(plan: ConstructionPlan): void {
  console.log(`requiredFacilityExists: ${plan.requiredFacility.exists ? "yes" : "no"}`);
  console.log(`fabricatorAvailable: ${plan.fabricator.available ? "yes" : "no"}`);
  console.log(`supplyCacheOnline: ${plan.supplyCache.online ? "yes" : "no"}`);
  console.log(`prerequisitesMet: ${plan.prerequisites.met ? "yes" : "no"}`);
  console.log(`inventorySufficient: ${plan.inventory.sufficient ? "yes" : "no"}`);
  console.log(`wouldCreateModule: ${plan.wouldCreateModule.displayName}`);
  console.log(`resourcesToSpend: ${JSON.stringify(plan.resourcesToSpend)}`);
  console.log(`canStart: ${plan.canStart ? "yes" : "no"}`);

  if (plan.blockingReasons.length === 0) {
    return;
  }

  console.log("blockingReasons:");
  for (const reason of plan.blockingReasons) {
    console.log(`- ${reason}`);
  }
}

export function printConstructionStarted(result: StartedConstruction): void {
  console.log(`Started construction for blueprint "${result.blueprintId}".`);
  console.log(`fabricatorId: ${result.fabricatorId}`);
  console.log(`outputModuleId: ${result.outputModuleId}`);
  console.log(`buildTicks: ${result.buildTicks}`);
  console.log(`remainingBuildTicks: ${result.remainingBuildTicks}`);
}

export function printConstructionStatus(jobs: ActiveConstructionJob[]): void {
  if (jobs.length === 0) {
    console.log("No active construction jobs.");
    return;
  }

  for (const [index, job] of jobs.entries()) {
    if (index > 0) {
      console.log("");
    }

    console.log(`fabricator: ${job.fabricatorAlias} (${job.fabricatorId})`);
    console.log(`blueprintId: ${job.blueprintId}`);
    console.log(`outputModuleId: ${job.outputModuleId}`);
    console.log(`buildTicks: ${job.buildTicks}`);
    console.log(`remainingTicks: ${job.remainingTicks}`);
  }
}

export function printInventoryList(entries: LocalInventoryEntry[]): void {
  if (entries.length === 0) {
    console.log("No inventory found.");
    return;
  }

  printAlignedTable(
    ["Resource Type", "Quantity"],
    entries.map((entry) => [entry.resourceType, String(entry.quantity)]),
  );
}

export function printResourceList(result: {
  catalogVersion: string;
  resources: OfficialResource[];
}): void {
  if (result.resources.length === 0) {
    console.log("No resources found.");
    return;
  }

  const sortedResources = [...result.resources].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.displayName.localeCompare(right.displayName),
  );
  printAlignedTable(
    ["Resource Type", "Display Name", "Kind", "Rarity", "Unit"],
    sortedResources.map((resource) => [
      resource.resourceType,
      resource.displayName,
      resource.kind,
      resource.rarity,
      resource.unit ?? "(none)",
    ]),
  );
  console.log(`catalogVersion: ${result.catalogVersion}`);
  console.log("resource catalog: possible resource types in the Kepler world");
  console.log("local inventory: resources your habitat owns, handled later");
  console.log("blueprint requirements: resources or modules needed to build something later");
}

export function printSolarStatus(result: SolarIrradiance): void {
  console.log(`current sunlight: ${result.irradianceWPerM2} W/m2`);
  console.log(`condition: ${result.condition}`);
  console.log("Kepler world sunlight: this is the remote solar reading for your habitat.");
  console.log("Local batteries and module state stay in your habitat CLI.");
}

export function printUnregisterSuccess(displayName: string): void {
  console.log(`Unregistered habitat "${displayName}".`);
  console.log("removed: .habitat/registration.json");
  console.log("removed: .habitat/modules.json");
  console.log("removed: .habitat/blueprints.json");
}
