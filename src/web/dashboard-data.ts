import { createApiClient, ApiError } from "../api/client";
import type {
  BackendWorldScanInput,
  BackendWorldScanResponse,
} from "../api/backend-api";
import type {
  ExplorationState,
  HabitatAlert,
  LocalInventoryEntry,
  LocalHabitatModule,
  ModuleRuntimeStatus,
  StarterHuman,
} from "../kepler";

export type PublicRegistration = {
  habitatUuid: string;
  habitatId: string;
  displayName: string;
  moduleCount: number;
};

export type RegistrationResponse = {
  registration: PublicRegistration | null;
};

export type StatusResponse = {
  registration: PublicRegistration;
  habitat: {
    habitatSlug: string;
    status: string;
    catalogVersion: string;
    lastSeenAt: string | null;
  };
  moduleCount: number;
  currentTick: number;
};

export type ModulePowerStatusResponse = {
  rows: Array<{
    displayName: string;
    declaredStatus: string;
    effectiveState: ModuleRuntimeStatus | "busy";
    currentPowerDrawKw: number;
  }>;
  totalCurrentPowerDrawKw: number;
  oneTickEnergyCostKwh: number;
};

export type SolarIrradianceResponse = {
  irradianceWPerM2: number;
  condition: string;
};

export type TickBatterySummary = {
  id: string;
  alias: string;
  currentEnergyKwh: number;
  energyStorageKwh: number;
};

export type TickResultResponse = {
  startTick: number;
  endTick: number;
  totalEnergyUsedKwh: number;
  solarCharging: {
    generatedKwh: number;
    chargedKwh: number;
    reason: string;
  };
  batteries: TickBatterySummary[];
  completedConstructions: Array<{
    fabricatorId: string;
    outputModuleId: string;
    blueprintId: string;
  }>;
};

export type PanelErrors = Partial<Record<"humans" | "eva" | "alerts", string>>;

export type DashboardScannedTile = BackendWorldScanResponse["scan"]["tiles"][number] & {
  key: string;
  scannedAt: string;
  collectedKg?: number;
};

export type InventoryEntry = LocalInventoryEntry;

export type RegisteredDashboardModel = {
  kind: "registered";
  registration: PublicRegistration;
  status: StatusResponse;
  modules: LocalHabitatModule[];
  powerStatus: ModulePowerStatusResponse;
  humans: StarterHuman[];
  eva: ExplorationState;
  alerts: HabitatAlert[];
  panelErrors: PanelErrors;
  registerPending: boolean;
  unregisterPending: boolean;
  confirmUnregister: boolean;
  errorMessage: string | null;
};

export type UnregisteredDashboardModel = {
  kind: "unregistered";
  registration: null;
  registerPending: boolean;
  unregisterPending: boolean;
  confirmUnregister: boolean;
  errorMessage: string | null;
};

export type ErrorDashboardModel = {
  kind: "error";
  registration: PublicRegistration | null;
  errorMessage: string | null;
  registerPending: boolean;
  unregisterPending: boolean;
  confirmUnregister: boolean;
};

export type DashboardModel =
  | RegisteredDashboardModel
  | UnregisteredDashboardModel
  | ErrorDashboardModel;

export type DashboardApi = {
  getRegistration(): Promise<RegistrationResponse>;
  register(displayName: string): Promise<{ registration: PublicRegistration }>;
  unregister(): Promise<{ registration: PublicRegistration }>;
  getStatus(): Promise<StatusResponse>;
  listModules(): Promise<LocalHabitatModule[]>;
  getModule(moduleReference: string): Promise<LocalHabitatModule>;
  getModulePowerStatus(): Promise<ModulePowerStatusResponse>;
  listHumans(): Promise<StarterHuman[]>;
  moveHuman(humanId: string, moduleId: string): Promise<StarterHuman>;
  getEvaStatus(): Promise<ExplorationState>;
  deployHuman(humanId: string): Promise<ExplorationState>;
  moveExplorer(x: number, y: number): Promise<ExplorationState>;
  dockExplorer(): Promise<ExplorationState>;
  scanWorld(input: BackendWorldScanInput): Promise<BackendWorldScanResponse>;
  listInventory(): Promise<InventoryEntry[]>;
  listAlerts(): Promise<HabitatAlert[]>;
  acknowledgeAlert(alertId: string): Promise<HabitatAlert>;
  collectMaterial(quantityKg: number): Promise<{
    resourceType: string;
    collectedKg: number;
    remainingKg: number;
  }>;
  getSolarIrradiance(): Promise<SolarIrradianceResponse>;
  setModuleStatus(moduleReference: string, status: "offline" | "online"): Promise<{
    module: LocalHabitatModule;
    currentPowerDrawKw: number;
  }>;
  advanceTicks(count: number): Promise<TickResultResponse>;
};

export function resolveDashboardApiBaseUrl(options?: { isDev?: boolean }) {
  const isDev = options?.isDev ?? Boolean(import.meta.env?.DEV);
  return isDev ? "/api" : "";
}

export function createDashboardApi(
  overrides?: Partial<DashboardApi>,
  options?: { baseUrl?: string },
) {
  const client = createApiClient({ baseUrl: options?.baseUrl ?? resolveDashboardApiBaseUrl() });

  return {
    async getRegistration(): Promise<RegistrationResponse> {
      return client.requestJson("/registration", { method: "GET" });
    },

    async register(displayName: string): Promise<{ registration: PublicRegistration }> {
      return client.requestJson("/registration", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
    },

    async unregister(): Promise<{ registration: PublicRegistration }> {
      return client.requestJson("/registration", { method: "DELETE" });
    },

    async getStatus(): Promise<StatusResponse> {
      return client.requestJson("/status", { method: "GET" });
    },

    async listModules(): Promise<LocalHabitatModule[]> {
      return client.requestJson("/modules", { method: "GET" });
    },

    async getModule(moduleReference: string): Promise<LocalHabitatModule> {
      return client.requestJson(`/modules/${encodeURIComponent(moduleReference)}`, { method: "GET" });
    },

    async getModulePowerStatus(): Promise<ModulePowerStatusResponse> {
      return client.requestJson("/modules/status", { method: "GET" });
    },

    async listHumans(): Promise<StarterHuman[]> {
      return client.requestJson("/humans", { method: "GET" });
    },

    async moveHuman(humanId: string, moduleId: string): Promise<StarterHuman> {
      return client.requestJson(`/humans/${encodeURIComponent(humanId)}/location`, {
        method: "PUT",
        body: JSON.stringify({ moduleId }),
      });
    },

    async getEvaStatus(): Promise<ExplorationState> {
      return client.requestJson("/eva", { method: "GET" });
    },

    async deployHuman(humanId: string): Promise<ExplorationState> {
      return client.requestJson("/eva/deploy", {
        method: "POST",
        body: JSON.stringify({ humanId }),
      });
    },

    async moveExplorer(x: number, y: number): Promise<ExplorationState> {
      return client.requestJson("/eva/move", {
        method: "POST",
        body: JSON.stringify({ x, y }),
      });
    },

    async dockExplorer(): Promise<ExplorationState> {
      return client.requestJson("/eva/dock", { method: "POST" });
    },

    async scanWorld(input: BackendWorldScanInput): Promise<BackendWorldScanResponse> {
      const query = new URLSearchParams({
        sensorStrength: String(input.sensorStrength),
        radiusTiles: String(input.radiusTiles),
      });

      return client.requestJson(`/scan?${query.toString()}`, { method: "GET" });
    },

    async listInventory(): Promise<InventoryEntry[]> {
      return client.requestJson("/inventory", { method: "GET" });
    },

    async listAlerts(): Promise<HabitatAlert[]> {
      return client.requestJson("/alerts", { method: "GET" });
    },

    async acknowledgeAlert(alertId: string): Promise<HabitatAlert> {
      return client.requestJson(`/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: "POST",
      });
    },

    async collectMaterial(quantityKg: number): Promise<{
      resourceType: string;
      collectedKg: number;
      remainingKg: number;
    }> {
      return client.requestJson("/collect", {
        method: "POST",
        body: JSON.stringify({ quantityKg }),
      });
    },

    async getSolarIrradiance(): Promise<SolarIrradianceResponse> {
      return client.requestJson("/solar/irradiance", { method: "GET" });
    },

    async setModuleStatus(
      moduleReference: string,
      status: "offline" | "online",
    ): Promise<{
      module: LocalHabitatModule;
      currentPowerDrawKw: number;
    }> {
      return client.requestJson(`/modules/${encodeURIComponent(moduleReference)}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    },

    async advanceTicks(count: number): Promise<TickResultResponse> {
      return client.requestJson("/ticks", {
        method: "POST",
        body: JSON.stringify({ count }),
      });
    },

    ...overrides,
  };
}

export async function loadDashboardData(api: DashboardApi): Promise<DashboardModel> {
  try {
    const registrationResult = await api.getRegistration();
    if (!registrationResult.registration) {
      return {
        kind: "unregistered",
        registration: null,
        registerPending: false,
        unregisterPending: false,
        confirmUnregister: false,
        errorMessage: null,
      };
    }

    const [status, modules, powerStatus, humans, eva, alerts] = await Promise.all([
      api.getStatus(),
      api.listModules(),
      api.getModulePowerStatus(),
      api.listHumans(),
      api.getEvaStatus(),
      api.listAlerts(),
    ]);

    return {
      kind: "registered",
      registration: registrationResult.registration,
      status,
      modules,
      powerStatus,
      humans,
      eva,
      alerts,
      panelErrors: {},
      registerPending: false,
      unregisterPending: false,
      confirmUnregister: false,
      errorMessage: null,
    };
  } catch (error) {
    return {
      kind: "error",
      registration: null,
      errorMessage: getErrorMessage(error),
      registerPending: false,
      unregisterPending: false,
      confirmUnregister: false,
    };
  }
}

export async function registerHabitat(api: DashboardApi, displayName: string): Promise<DashboardModel> {
  await api.register(displayName);
  return loadDashboardData(api);
}

export async function unregisterHabitat(api: DashboardApi): Promise<DashboardModel> {
  await api.unregister();
  return loadDashboardData(api);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while talking to the Habitat API.";
}
