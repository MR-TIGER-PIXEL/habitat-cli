import { createApiClient } from "./client";
import type { ActiveConstructionJob, CanceledConstruction, ConstructionPlan, CompletedConstruction, OfficialResource, SolarIrradiance, StartedConstruction, StoredBlueprint, TickBatterySummary, SolarChargingSummary } from "../kepler";
import type { LocalHabitatModule } from "../kepler";

export type BackendRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
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

export function createBackendApiClient(config: BackendConfig) {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    fetchImpl: config.fetchImpl,
  });

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

    async listModules(): Promise<LocalHabitatModule[]> {
      return client.requestJson("/modules", { method: "GET" });
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
