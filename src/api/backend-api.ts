import { createApiClient } from "./client";
import type { ActiveConstructionJob, CanceledConstruction, ConstructionPlan, CompletedConstruction, HabitatAlert, OfficialResource, SolarIrradiance, StartedConstruction, StoredBlueprint, TickBatterySummary, SolarChargingSummary } from "../kepler";
import type { ExplorationState, LocalHabitatModule, StarterHuman } from "../kepler";
import type { HabitatRegistrationStream } from "../kepler";

export type BackendRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  apiToken: string;
  streamUrl: string | null;
  stream: HabitatRegistrationStream | null;
  moduleCount: number;
};

export type BackendStatus = {
  registration: BackendRegistration;
  habitat: {
    habitatSlug: string;
    status: string;
    catalogVersion: string;
    lastSeenAt: string | null;
  };
  moduleCount: number;
  currentTick: number;
};

export type BackendClockStatus = {
  clock: {
    mode: "manual" | "kepler";
    listening: boolean;
    manualTicksAllowed: boolean;
    connectionState: "connected" | "connecting" | "disconnected" | "error";
    latestAbsoluteKeplerTick: number | null;
    latestAdvancedBy: number | null;
    lastConnectedAt: string | null;
    lastMessageAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
  };
};

export type BackendClockEvent = {
  tick: number;
  advancedBy: number;
  issuedAt: string;
  applied: boolean;
  previousTick?: number | null;
};

export type BackendBlueprintCatalog = {
  catalogVersion: string;
  blueprints: StoredBlueprint[];
};

export type BackendBlueprintResponse = {
  blueprint: StoredBlueprint;
};

export type BackendResourceCatalog = {
  catalogVersion: string;
  resources: OfficialResource[];
};

export type BackendSolarIrradiance = {
  irradianceWPerM2: SolarIrradiance["irradianceWPerM2"];
  condition: SolarIrradiance["condition"];
};

export type BackendModulePowerStatus = {
  rows: Array<{
    displayName: string;
    declaredStatus: string;
    effectiveState: string;
    currentPowerDrawKw: number;
  }>;
  totalCurrentPowerDrawKw: number;
  oneTickEnergyCostKwh: number;
};

export type BackendModuleShow = {
  module: LocalHabitatModule;
  modules: LocalHabitatModule[];
  blueprint: StoredBlueprint | null;
};

export type BackendInventoryEntry = {
  resourceType: string;
  quantity: number;
};

export type BackendHuman = StarterHuman;
export type BackendAlert = HabitatAlert;
export type BackendEvaStatus = ExplorationState;
export type BackendCollectionResult = {
  resourceType: string;
  collectedKg: number;
  remainingKg: number;
};

export type BackendTickResult = {
  startTick: number;
  endTick: number;
  totalEnergyUsedKwh: number;
  solarCharging: SolarChargingSummary;
  batteries: TickBatterySummary[];
  completedConstructions: CompletedConstruction[];
};

export type BackendConfig = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type BackendWorldScanProbability = {
  resourceType: string | null;
  probabilityPct: number;
};

export type BackendWorldScanQuantityEstimate = {
  resourceType: string;
  unit: string;
  estimatedKg: number;
  minimumKg: number;
  maximumKg: number;
  exact: boolean;
};

export type BackendWorldScanInput = {
  sensorStrength: number | string;
  radiusTiles: number | string;
};

export type BackendWorldScanResponse = {
  scan: {
    modelVersion: string;
    origin: {
      x: number;
      y: number;
    };
    sensorStrength: number;
    radiusTiles: number;
    tiles: Array<{
      x: number;
      y: number;
      terrain: string;
      distanceTiles: number;
      probabilities: BackendWorldScanProbability[];
      topCandidate: BackendWorldScanProbability;
      quantityEstimate: BackendWorldScanQuantityEstimate | null;
    }>;
  };
};

export function createBackendApiClient(config: BackendConfig) {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl,
  });
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async getRegistration(): Promise<BackendRegistration | null> {
      const response = await client.requestJson<{ registration: BackendRegistration | null }>(
        "/registration",
        { method: "GET" },
      );
      return response.registration;
    },

    async register(displayName: string): Promise<{
      registration: BackendRegistration;
      moduleCount: number;
    }> {
      return client.requestJson("/registration", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
    },

    async status(): Promise<BackendStatus> {
      return client.requestJson("/status", { method: "GET" });
    },

    async clockStatus(): Promise<BackendClockStatus> {
      return client.requestJson("/clock/status", { method: "GET" });
    },

    async clockListenOn(): Promise<BackendClockStatus> {
      return client.requestJson("/clock/listen/on", { method: "POST" });
    },

    async clockListenOff(): Promise<BackendClockStatus> {
      return client.requestJson("/clock/listen/off", { method: "POST" });
    },

    async watchClockEvents(input: {
      signal?: AbortSignal;
      onEvent: (event: BackendClockEvent) => void;
    }): Promise<void> {
      const response = await fetchImpl(`${config.baseUrl}/clock/events`, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
        },
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status} ${response.statusText}.`);
      }

      if (!response.body) {
        return;
      }

      await consumeClockEventStream(response.body, input.onEvent, input.signal);
    },

    async unregister(): Promise<{
      registration: BackendRegistration;
    }> {
      return client.requestJson("/registration", { method: "DELETE" });
    },

    async listOfficialBlueprints(): Promise<BackendBlueprintCatalog> {
      return client.requestJson("/catalog/blueprints", { method: "GET" });
    },

    async getOfficialBlueprint(blueprintId: string): Promise<BackendBlueprintResponse> {
      return client.requestJson(`/catalog/blueprints/${encodeURIComponent(blueprintId)}`, {
        method: "GET",
      });
    },

    async listOfficialResources(): Promise<BackendResourceCatalog> {
      return client.requestJson("/catalog/resources", { method: "GET" });
    },

    async getSolarIrradiance(): Promise<BackendSolarIrradiance> {
      return client.requestJson("/solar/irradiance", { method: "GET" });
    },

    async scanWorld(input: BackendWorldScanInput): Promise<BackendWorldScanResponse> {
      const query = new URLSearchParams({
        sensorStrength: String(input.sensorStrength),
        radiusTiles: String(input.radiusTiles),
      });
      return client.requestJson(`/scan?${query.toString()}`, { method: "GET" });
    },

    async listModules(): Promise<LocalHabitatModule[]> {
      return client.requestJson("/modules", { method: "GET" });
    },

    async listHumans(): Promise<BackendHuman[]> {
      return client.requestJson("/humans", { method: "GET" });
    },

    async listAlerts(): Promise<BackendAlert[]> {
      return client.requestJson("/alerts", { method: "GET" });
    },

    async acknowledgeAlert(alertId: string): Promise<BackendAlert> {
      return client.requestJson(`/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: "POST",
      });
    },

    async moveHuman(humanId: string, moduleId: string): Promise<BackendHuman> {
      return client.requestJson(`/humans/${encodeURIComponent(humanId)}/location`, {
        method: "PUT",
        body: JSON.stringify({ moduleId }),
      });
    },

    async getEvaStatus(): Promise<BackendEvaStatus> {
      return client.requestJson("/eva", { method: "GET" });
    },

    async deployHuman(humanId: string): Promise<BackendEvaStatus> {
      return client.requestJson("/eva/deploy", {
        method: "POST",
        body: JSON.stringify({ humanId }),
      });
    },

    async moveExplorer(x: number, y: number): Promise<BackendEvaStatus> {
      return client.requestJson("/eva/move", {
        method: "POST",
        body: JSON.stringify({ x, y }),
      });
    },

    async dockExplorer(): Promise<BackendEvaStatus> {
      return client.requestJson("/eva/dock", { method: "POST" });
    },

    async collectMaterial(quantityKg: number | string): Promise<BackendCollectionResult> {
      return client.requestJson("/collect", {
        method: "POST",
        body: JSON.stringify({ quantityKg }),
      });
    },

    async getModule(moduleReference: string): Promise<BackendModuleShow> {
      return client.requestJson(`/modules/${encodeURIComponent(moduleReference)}`, {
        method: "GET",
      });
    },

    async createModule(input: {
      id: string;
      blueprintId: string;
      displayName: string;
      connectedTo?: string[];
      runtimeAttributes?: Record<string, unknown>;
      capabilities?: string[];
    }): Promise<LocalHabitatModule> {
      return client.requestJson("/modules", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async updateModule(
      moduleReference: string,
      input: {
        displayName?: string;
        connectedTo?: string[];
        runtimeAttributes?: Record<string, unknown>;
        capabilities?: string[];
      },
    ): Promise<LocalHabitatModule> {
      return client.requestJson(`/modules/${encodeURIComponent(moduleReference)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    async deleteModule(moduleReference: string): Promise<LocalHabitatModule> {
      return client.requestJson(`/modules/${encodeURIComponent(moduleReference)}`, {
        method: "DELETE",
      });
    },

    async setModuleStatus(
      moduleReference: string,
      status: string,
    ): Promise<{
      module: LocalHabitatModule;
      currentPowerDrawKw: number;
    }> {
      return client.requestJson(`/modules/${encodeURIComponent(moduleReference)}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    },

    async getModulePowerStatus(): Promise<BackendModulePowerStatus> {
      return client.requestJson("/modules/status", { method: "GET" });
    },

    async listInventory(): Promise<BackendInventoryEntry[]> {
      return client.requestJson("/inventory", { method: "GET" });
    },

    async addInventory(resourceType: string, quantity: number): Promise<BackendInventoryEntry> {
      return client.requestJson("/inventory", {
        method: "POST",
        body: JSON.stringify({ resourceType, quantity }),
      });
    },

    async removeInventory(resourceType: string, quantity: number): Promise<BackendInventoryEntry> {
      return client.requestJson("/inventory", {
        method: "DELETE",
        body: JSON.stringify({ resourceType, quantity }),
      });
    },

    async tick(count: number): Promise<BackendTickResult> {
      return client.requestJson("/ticks", {
        method: "POST",
        body: JSON.stringify({ count }),
      });
    },

    async planConstruction(blueprintId: string): Promise<ConstructionPlan> {
      return client.requestJson("/construction/plan", {
        method: "POST",
        body: JSON.stringify({ blueprintId }),
      });
    },

    async startConstruction(blueprintId: string): Promise<StartedConstruction> {
      return client.requestJson("/construction", {
        method: "POST",
        body: JSON.stringify({ blueprintId }),
      });
    },

    async constructionStatus(): Promise<ActiveConstructionJob[]> {
      return client.requestJson("/construction", { method: "GET" });
    },

    async cancelConstruction(moduleReference: string): Promise<CanceledConstruction> {
      return client.requestJson(`/construction/${encodeURIComponent(moduleReference)}`, {
        method: "DELETE",
      });
    },
  };
}

export async function consumeClockEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: BackendClockEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abortStream = () => {
    void reader.cancel();
  };

  signal?.addEventListener("abort", abortStream, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        const event = parseClockEventSseSegment(segment);
        if (event) {
          onEvent(event);
        }
      }
    }

    const trailingEvent = parseClockEventSseSegment(buffer);
    if (trailingEvent) {
      onEvent(trailingEvent);
    }
  } finally {
    signal?.removeEventListener("abort", abortStream);
    reader.releaseLock();
  }
}

function parseClockEventSseSegment(segment: string): BackendClockEvent | null {
  const dataLines = segment
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join("\n")) as BackendClockEvent;
  } catch {
    return null;
  }
}
