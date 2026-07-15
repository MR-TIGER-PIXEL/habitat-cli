import { createApiClient } from "../api/client";
import { readEnvironmentFile } from "../kepler";
import {
  observeCarryingCapacityAlert,
  observeCollectionFailureAlert,
  resolveCarryingCapacityAlert,
  resolveCollectionFailureAlert,
} from "./alert-service";
import {
  readExplorationState,
  readRegistration,
  writeExplorationState,
} from "./registration-store";
import { assertExplorerOperational } from "./eva-state";

export type CollectionResult = {
  resourceType: string;
  collectedKg: number;
  remainingKg: number;
};

type KeplerCollectionResponse = {
  collection: CollectionResult & {
    x: number;
    y: number;
    unit: "kg";
  };
};

export async function collectMaterial(cwd: string, quantityKg: number): Promise<CollectionResult> {
  const registration = readRegistration(cwd);
  if (!registration) {
    throw new Error("No habitat registration found.");
  }

  const exploration = readExplorationState(cwd);
  if (!exploration.deployedHumanId) {
    throw new Error("No human is currently deployed.");
  }
  assertExplorerOperational(exploration);
  if (!Number.isInteger(quantityKg) || quantityKg <= 0) {
    throw new Error("Collection quantity must be a positive whole number of kilograms.");
  }

  const carriedKg = Object.values(exploration.carriedResources)
    .reduce((total, quantity) => total + quantity, 0);
  if (carriedKg + quantityKg > exploration.maxCarryingCapacityKg) {
    throw new Error(
      `Collection would exceed the explorer's carrying capacity of ${exploration.maxCarryingCapacityKg} kg.`,
    );
  }

  const kepler = createKeplerClient(cwd);
  try {
    const response = await kepler.requestJson<KeplerCollectionResponse>("/world/collect", {
      method: "POST",
      body: JSON.stringify({
        habitatId: registration.habitatId,
        x: exploration.x,
        y: exploration.y,
        quantityKg,
      }),
    });

    const collection = response.collection;
    const nextState = {
      ...exploration,
      carriedResources: {
        ...exploration.carriedResources,
        [collection.resourceType]: (exploration.carriedResources[collection.resourceType] ?? 0) + collection.collectedKg,
      },
    };
    writeExplorationState(cwd, nextState);
    resolveCollectionFailureAlert(cwd, { humanId: exploration.deployedHumanId });

    const totalCarriedKg = Object.values(nextState.carriedResources)
      .reduce((total, quantity) => total + quantity, 0);
    if (totalCarriedKg >= nextState.maxCarryingCapacityKg) {
      await observeCarryingCapacityAlert(cwd, { humanId: exploration.deployedHumanId });
    } else {
      resolveCarryingCapacityAlert(cwd, { humanId: exploration.deployedHumanId });
    }

    return {
      resourceType: collection.resourceType,
      collectedKg: collection.collectedKg,
      remainingKg: collection.remainingKg,
    };
  } catch (error) {
    await observeCollectionFailureAlert(cwd, {
      humanId: exploration.deployedHumanId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function createKeplerClient(cwd: string) {
  const env = readEnvironmentFile(cwd);
  const token = process.env.KEPLER_PLANET_TOKEN ?? env.KEPLER_PLANET_TOKEN;
  if (!token) {
    throw new Error('Missing Kepler token. Set "KEPLER_PLANET_TOKEN" in your environment or .env file.');
  }

  const baseUrl = (process.env.KEPLER_BASE_URL ?? env.KEPLER_BASE_URL ?? "https://planet.turingguild.com")
    .replace(/\/+$/, "");
  return createApiClient({
    baseUrl,
    headers: { authorization: `Bearer ${token}` },
  });
}
