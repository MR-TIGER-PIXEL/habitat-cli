import { createApiClient } from "../api/client";
import type { ExplorationState, LocalHabitatModule, StarterHuman, WorldSectorBounds } from "../kepler";
import {
  observeExplorerDeployedAlert,
  resolveBatteryExhaustedAlert,
  resolveBatteryLowAlert,
  resolveCarryingCapacityAlert,
  resolveOxygenExhaustedAlert,
  resolveOxygenLowAlert,
  resolveExplorerDeployedAlert,
} from "./alert-service";
import { assertExplorerOperational, createDeployedEvaState } from "./eva-state";
import {
  dockExplorerState,
  readExplorationState,
  readHumans,
  readModules,
  readRegistration,
  writeExplorationState,
} from "./registration-store";

export async function getEvaStatus(cwd: string): Promise<ExplorationState> {
  ensureRegistered(cwd);
  return readExplorationState(cwd);
}

export async function deployHuman(cwd: string, humanId: string): Promise<ExplorationState> {
  ensureRegistered(cwd);
  const exploration = readExplorationState(cwd);
  if (exploration.deployedHumanId) {
    throw new Error(`Human "${exploration.deployedHumanId}" is already deployed.`);
  }

  const humans = readHumans(cwd);
  const human = humans.find((entry) => entry.id === humanId);
  if (!human) {
    throw new Error(`Human "${humanId}" not found.`);
  }

  const suitport = findActiveBasicSuitport(readModules(cwd));
  if (!suitport) {
    throw new Error("No active Basic Suitport module found.");
  }
  if (human.locationModuleId !== suitport.id) {
    throw new Error(`Human "${humanId}" must currently be in active Basic Suitport module "${suitport.id}".`);
  }

  const nextState = createDeployedEvaState(exploration, human.id);
  writeExplorationState(cwd, nextState);
  await observeExplorerDeployedAlert(cwd, { humanId: human.id });
  resolveBatteryLowAlert(cwd, { humanId: human.id });
  resolveBatteryExhaustedAlert(cwd, { humanId: human.id });
  resolveOxygenLowAlert(cwd, { humanId: human.id });
  resolveOxygenExhaustedAlert(cwd, { humanId: human.id });
  return nextState;
}

export async function moveExplorer(
  cwd: string,
  destination: { x: number; y: number },
): Promise<ExplorationState> {
  ensureRegistered(cwd);
  const exploration = readExplorationState(cwd);
  if (!exploration.deployedHumanId) {
    throw new Error("No human is currently deployed.");
  }
  assertExplorerOperational(exploration);

  assertAdjacentMove(exploration, destination);
  const sectorBounds = await getCurrentWorldSectorBounds(cwd);
  if (!isInsideSector(destination, sectorBounds)) {
    throw new Error(
      `Move to (${destination.x}, ${destination.y}) is outside the current Kepler sector.`,
    );
  }

  const nextState: ExplorationState = {
    ...exploration,
    x: destination.x,
    y: destination.y,
  };
  writeExplorationState(cwd, nextState);
  return nextState;
}

export async function dockExplorer(cwd: string): Promise<ExplorationState> {
  ensureRegistered(cwd);
  const exploration = readExplorationState(cwd);
  if (!exploration.deployedHumanId) {
    throw new Error("No human is currently deployed.");
  }
  if (exploration.x !== 0 || exploration.y !== 0) {
    throw new Error("Docking is only allowed at (0, 0).");
  }

  const suitport = findActiveBasicSuitport(readModules(cwd));
  if (!suitport) {
    throw new Error("No active Basic Suitport module found.");
  }

  const nextState = dockExplorerState(cwd, {
    deployedHumanId: exploration.deployedHumanId,
    suitportModuleId: suitport.id,
  });
  resolveExplorerDeployedAlert(cwd, { humanId: exploration.deployedHumanId });
  resolveCarryingCapacityAlert(cwd, { humanId: exploration.deployedHumanId });
  resolveBatteryLowAlert(cwd, { humanId: exploration.deployedHumanId });
  resolveBatteryExhaustedAlert(cwd, { humanId: exploration.deployedHumanId });
  resolveOxygenLowAlert(cwd, { humanId: exploration.deployedHumanId });
  resolveOxygenExhaustedAlert(cwd, { humanId: exploration.deployedHumanId });
  return nextState;
}

function ensureRegistered(cwd: string): void {
  if (!readRegistration(cwd)) {
    throw new Error("No habitat registration found.");
  }
}

function findActiveBasicSuitport(modules: LocalHabitatModule[]): LocalHabitatModule | null {
  return modules.find((module) =>
    module.blueprintId === "basic-suitport"
    && module.runtimeAttributes.status === "active") ?? null;
}

function assertAdjacentMove(
  current: ExplorationState,
  destination: { x: number; y: number },
): void {
  const deltaX = Math.abs(destination.x - current.x);
  const deltaY = Math.abs(destination.y - current.y);
  const totalDistance = deltaX + deltaY;

  if (deltaX === 1 && deltaY === 1) {
    throw new Error("Diagonal EVA moves are not allowed.");
  }
  if (totalDistance !== 1) {
    throw new Error("EVA moves must be exactly one adjacent north, south, east, or west tile.");
  }
}

function isInsideSector(position: { x: number; y: number }, bounds: WorldSectorBounds): boolean {
  return position.x >= bounds.minX
    && position.x <= bounds.maxX
    && position.y >= bounds.minY
    && position.y <= bounds.maxY;
}

async function getCurrentWorldSectorBounds(cwd: string): Promise<WorldSectorBounds> {
  const registration = readRegistration(cwd);
  if (!registration) {
    throw new Error("No habitat registration found.");
  }

  const query = new URLSearchParams({ habitatId: registration.habitatId });
  const kepler = createKeplerClient();
  const response = await kepler.requestJson<unknown>(`/world/sectors/current?${query.toString()}`, {
    method: "GET",
  });
  return parseWorldSectorBounds(response);
}

function createKeplerClient() {
  return createApiClient({
    baseUrl: normalizeBaseUrl(process.env.KEPLER_BASE_URL ?? "https://planet.turingguild.com"),
    headers: {
      authorization: `Bearer ${readKeplerToken()}`,
    },
  });
}

function readKeplerToken(): string {
  const token = process.env.KEPLER_PLANET_TOKEN;
  if (!token) {
    throw new Error('Missing Kepler token. Set "KEPLER_PLANET_TOKEN" for the backend.');
  }
  return token;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseWorldSectorBounds(response: unknown): WorldSectorBounds {
  const directBounds = readBoundsCandidate(response);
  if (directBounds) return directBounds;

  if (response && typeof response === "object") {
    const record = response as Record<string, unknown>;
    const nestedSector = readBoundsCandidate(record.sector);
    if (nestedSector) return nestedSector;
    const sectorBounds = readBoundsCandidate(
      (record.sector as Record<string, unknown> | undefined)?.bounds,
    );
    if (sectorBounds) return sectorBounds;
    const nestedBounds = readBoundsCandidate(record.bounds);
    if (nestedBounds) return nestedBounds;
  }

  throw new Error("Kepler current sector response did not include usable bounds.");
}

function readBoundsCandidate(value: unknown): WorldSectorBounds | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const minX = asNumber(record.minX);
  const maxX = asNumber(record.maxX);
  const minY = asNumber(record.minY);
  const maxY = asNumber(record.maxY);
  if (minX !== null && maxX !== null && minY !== null && maxY !== null) {
    return { minX, maxX, minY, maxY };
  }

  const origin = readOriginAndDimensions(record);
  if (origin) {
    return {
      minX: origin.originX,
      maxX: origin.originX + origin.width - 1,
      minY: origin.originY,
      maxY: origin.originY + origin.height - 1,
    };
  }

  return null;
}

function readOriginAndDimensions(
  record: Record<string, unknown>,
): { originX: number; originY: number; width: number; height: number } | null {
  const originX = asNumber(record.originX) ?? asNumber((record.origin as Record<string, unknown> | undefined)?.x);
  const originY = asNumber(record.originY) ?? asNumber((record.origin as Record<string, unknown> | undefined)?.y);
  const width = asNumber(record.width) ?? asNumber((record.size as Record<string, unknown> | undefined)?.width);
  const height = asNumber(record.height) ?? asNumber((record.size as Record<string, unknown> | undefined)?.height);

  if (originX === null || originY === null || width === null || height === null) {
    return null;
  }

  return { originX, originY, width, height };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
