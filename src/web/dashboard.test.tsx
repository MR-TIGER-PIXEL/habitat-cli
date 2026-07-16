import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../api/client";
import { getHumanAvatarVariant, getModuleArtwork, humanAvatarOverrides } from "./media";
import {
  createDashboardApi,
  loadDashboardData,
  registerHabitat,
  resolveDashboardApiBaseUrl,
  type DashboardScannedTile,
  type DashboardModel,
  type TickResultResponse,
} from "./dashboard-data";
import { DashboardApp } from "./DashboardApp";

const unregisteredModel: DashboardModel = {
  kind: "unregistered",
  registration: null,
  registerPending: false,
  unregisterPending: false,
  confirmUnregister: false,
  errorMessage: null,
};

const latestTickResult: TickResultResponse = {
  startTick: 42,
  endTick: 102,
  totalEnergyUsedKwh: 0.032,
  solarCharging: {
    generatedKwh: 0.05,
    chargedKwh: 0.018,
    reason: "charged online batteries",
  },
  batteries: [
    {
      id: "module-battery-1",
      alias: "bb-1",
      currentEnergyKwh: 12,
      energyStorageKwh: 20,
    },
  ],
  completedConstructions: [],
};

const scanMemory: Record<string, DashboardScannedTile> = {
  "1,0": {
    key: "1,0",
    x: 1,
    y: 0,
    terrain: "flat",
    distanceTiles: 0,
    probabilities: [
      { resourceType: "ferrite", probabilityPct: 45.5 },
      { resourceType: "ice-regolith", probabilityPct: 24.25 },
      { resourceType: null, probabilityPct: 30.25 },
    ],
    topCandidate: { resourceType: "ferrite", probabilityPct: 45.5 },
    quantityEstimate: {
      resourceType: "ferrite",
      unit: "kg",
      estimatedKg: 177,
      minimumKg: 100,
      maximumKg: 250,
      exact: false,
    },
    scannedAt: "2026-07-16T15:05:00Z",
  },
};

const registeredModel: DashboardModel = {
  kind: "registered",
  registration: {
    habitatUuid: "uuid-123",
    habitatId: "habitat-123",
    displayName: "Artemis Ridge",
    moduleCount: 2,
  },
  status: {
    registration: {
      habitatUuid: "uuid-123",
      habitatId: "habitat-123",
      displayName: "Artemis Ridge",
      moduleCount: 2,
    },
    habitat: {
      habitatSlug: "artemis-ridge",
      status: "online",
      catalogVersion: "v1",
      lastSeenAt: "2026-07-15T15:00:00Z",
    },
    moduleCount: 2,
    currentTick: 42,
  },
  modules: [
    {
      id: "module-command-1",
      blueprintId: "command-module",
      displayName: "Command Module",
      connectedTo: [],
      runtimeAttributes: { status: "active" },
      capabilities: ["command"],
      source: "registration",
    },
    {
      id: "module-suitport-1",
      blueprintId: "basic-suitport",
      displayName: "Basic Suitport",
      connectedTo: ["module-command-1"],
      runtimeAttributes: { status: "active", crewCapacity: 2 },
      capabilities: ["eva"],
      source: "registration",
    },
  ],
  powerStatus: {
    rows: [
      {
        displayName: "Command Module",
        declaredStatus: "active",
        effectiveState: "active",
        currentPowerDrawKw: 3.5,
      },
      {
        displayName: "Basic Suitport",
        declaredStatus: "active",
        effectiveState: "active",
        currentPowerDrawKw: 1.1,
      },
    ],
    totalCurrentPowerDrawKw: 4.6,
    oneTickEnergyCostKwh: 0.00097,
  },
  humans: [
    {
      id: "human-1",
      displayName: "Avery Stone",
      locationModuleId: "module-command-1",
    },
    {
      id: "human-2",
      displayName: "Mika Rowan",
      locationModuleId: "module-suitport-1",
    },
  ],
  eva: {
    deployedHumanId: "human-2",
    x: 1,
    y: 0,
    carriedResources: {
      ferrite: 5,
    },
    maxCarryingCapacityKg: 20,
    batteryPercent: 60,
    maxBatteryPercent: 100,
    batteryDrainPerTickPercent: 10,
    oxygenUnits: 40,
    maxOxygenUnits: 80,
    oxygenDrainPerTickUnits: 10,
  },
  alerts: [
    {
      id: "alert:eva-battery-low:human-2",
      type: "eva.battery-low",
      contract: {
        schemaVersion: "1",
        schema: {},
      },
      severity: "warning",
      status: "open",
      source: "local.eva",
      createdAt: "2026-07-16T15:00:00Z",
      lastObservedAt: "2026-07-16T15:01:00Z",
      occurrenceCount: 1,
      subjectHumanId: "human-2",
    },
  ],
  panelErrors: {},
  registerPending: false,
  unregisterPending: false,
  confirmUnregister: false,
  errorMessage: null,
};

describe("loadDashboardData", () => {
  test("returns an unregistered model when no habitat registration exists", async () => {
    const api = createDashboardApi({
      async getRegistration() {
        return { registration: null };
      },
      async register() {
        throw new Error("not used");
      },
      async unregister() {
        throw new Error("not used");
      },
      async getStatus() {
        throw new Error("not used");
      },
      async listModules() {
        throw new Error("not used");
      },
      async getModulePowerStatus() {
        throw new Error("not used");
      },
    });

    const result = await loadDashboardData(api);

    expect(result.kind).toBe("unregistered");
    expect(result.registration).toBeNull();
  });

  test("returns a registered model with status and module data", async () => {
    const api = createDashboardApi({
      async getRegistration() {
        return {
          registration: {
            habitatUuid: "uuid-123",
            habitatId: "habitat-123",
            displayName: "Artemis Ridge",
            moduleCount: 1,
          },
        };
      },
      async register() {
        throw new Error("not used");
      },
      async unregister() {
        throw new Error("not used");
      },
      async getStatus() {
        return registeredModel.status;
      },
      async listModules() {
        return registeredModel.modules;
      },
      async getModulePowerStatus() {
        return registeredModel.powerStatus;
      },
      async listHumans() {
        return registeredModel.humans;
      },
      async getEvaStatus() {
        return registeredModel.eva;
      },
      async listAlerts() {
        return registeredModel.alerts;
      },
    });

    const result = await loadDashboardData(api);

    expect(result.kind).toBe("registered");
    if (result.kind !== "registered") {
      throw new Error("Expected registered dashboard data");
    }
    expect(result.modules[0]?.displayName).toBe("Command Module");
    expect(result.powerStatus.rows[0]?.currentPowerDrawKw).toBe(3.5);
    expect(result.humans[0]?.displayName).toBe("Avery Stone");
    expect(result.eva?.deployedHumanId).toBe("human-2");
    expect(result.alerts[0]?.type).toBe("eva.battery-low");
  });

  test("surfaces backend error messages when the status fetch fails", async () => {
    const api = createDashboardApi({
      async getRegistration() {
        return {
          registration: {
            habitatUuid: "uuid-123",
            habitatId: "habitat-123",
            displayName: "Artemis Ridge",
            moduleCount: 1,
          },
        };
      },
      async register() {
        throw new Error("not used");
      },
      async unregister() {
        throw new Error("not used");
      },
      async getStatus() {
        throw new ApiError("No habitat registration found.", 404);
      },
      async listModules() {
        return [];
      },
      async getModulePowerStatus() {
        return {
          rows: [],
          totalCurrentPowerDrawKw: 0,
          oneTickEnergyCostKwh: 0,
        };
      },
      async listHumans() {
        return [];
      },
      async getEvaStatus() {
        return {
          deployedHumanId: null,
          x: 0,
          y: 0,
          carriedResources: {},
          maxCarryingCapacityKg: 20,
          batteryPercent: null,
          maxBatteryPercent: 100,
          batteryDrainPerTickPercent: 10,
          oxygenUnits: null,
          maxOxygenUnits: 80,
          oxygenDrainPerTickUnits: 10,
        };
      },
      async listAlerts() {
        return [];
      },
    });

    const result = await loadDashboardData(api);

    expect(result.kind).toBe("error");
    expect(result.errorMessage).toBe("No habitat registration found.");
  });

  test("registerHabitat reloads registration state from the API after a successful POST", async () => {
    const calls: string[] = [];
    const api = createDashboardApi({
      async getRegistration() {
        calls.push("getRegistration");
        return {
          registration: {
            habitatUuid: "uuid-123",
            habitatId: "habitat-123",
            displayName: "Artemis Ridge",
            moduleCount: 1,
          },
        };
      },
      async register(displayName: string) {
        calls.push(`register:${displayName}`);
        return {
          registration: {
            habitatUuid: "uuid-123",
            habitatId: "habitat-123",
            displayName,
            moduleCount: 1,
          },
        };
      },
      async unregister() {
        throw new Error("not used");
      },
      async getStatus() {
        calls.push("getStatus");
        return registeredModel.status;
      },
      async listModules() {
        calls.push("listModules");
        return registeredModel.modules;
      },
      async getModulePowerStatus() {
        calls.push("getModulePowerStatus");
        return registeredModel.powerStatus;
      },
      async listHumans() {
        calls.push("listHumans");
        return registeredModel.humans;
      },
      async getEvaStatus() {
        calls.push("getEvaStatus");
        return registeredModel.eva;
      },
      async listAlerts() {
        calls.push("listAlerts");
        return registeredModel.alerts;
      },
    });

    const result = await registerHabitat(api, "Artemis Ridge");

    expect(result.kind).toBe("registered");
    expect(calls).toEqual([
      "register:Artemis Ridge",
      "getRegistration",
      "getStatus",
      "listModules",
      "getModulePowerStatus",
      "listHumans",
      "getEvaStatus",
      "listAlerts",
    ]);
  });
});

describe("DashboardApp", () => {
  test("renders the registration CTA when no habitat is registered", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="registration"
        model={unregisteredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
      />,
    );

    expect(html).toContain("Register habitat");
    expect(html).not.toContain("Command Module");
  });

  test("renders module status and power usage for registered habitats", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="eva"
        model={registeredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
        latestTickResult={latestTickResult}
        solarIrradiance={{ irradianceWPerM2: 712, condition: "clear" }}
        scanMemory={scanMemory}
        selectedModuleId="module-command-1"
        selectedHumanId="human-2"
        selectedTileKey="1,0"
        scanStrengthValue="60"
        scanRadiusValue="1"
      />,
    );

    expect(html).toContain("EVA Operations");
    expect(html).toContain("Coordinate map");
    expect(html).toContain("Explorer telemetry");
    expect(html).toContain("Estimated ticks remaining");
    expect(html).toContain("Material legend");
    expect(html).toContain("Scan current location");
    expect(html).toContain("ferrite");
  });

  test("shows EVA suit information as unavailable when the selected human is not deployed", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="crew"
        model={registeredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
        collectionQuantityValue="5"
        scanStrengthValue="60"
        scanRadiusValue="0"
        selectedHumanId="human-1"
      />,
    );

    expect(html).toContain("Human detail panel");
    expect(html).toContain("Battery / Oxygen");
    expect(html).toContain("Unavailable");
  });

  test("renders unknown tiles as unexplored when they are not present in scan memory", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="eva"
        model={registeredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
        collectionQuantityValue="5"
        scanStrengthValue="60"
        scanRadiusValue="0"
        mapCenter={{ x: 0, y: 0 }}
        mapZoom={1}
      />,
    );

    expect(html).toContain("Unexplored");
  });

  test("renders a destructive confirmation state before unregistering", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="registration"
        model={{ ...registeredModel, confirmUnregister: true }}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
      />,
    );

    expect(html).toContain("Confirm habitat unregister");
    expect(html).toContain("This keeps the existing confirmation step");
  });

  test("shows module control loading state and disables the action while pending", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="modules"
        model={registeredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
        pendingModuleId="module-command-1"
      />,
    );

    expect(html).toContain("Updating...");
    expect(html).toContain("disabled");
  });

  test("shows custom tick validation errors clearly", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="registration"
        model={registeredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue="0"
        tickInputError="Use a positive whole number."
      />,
    );

    expect(html).toContain("Registration");
  });

  test("enables tick controls for registered habitats", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        activeSection="overview"
        model={registeredModel}
        inventory={[]}
        inventoryLoaded={false}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue="12"
      />,
    );

    expect(html).toContain("Mission overview");
    expect(html).toContain("Unresolved alerts");
    expect(html).not.toContain("Scan current location");
  });
});

describe("createDashboardApi", () => {
  test("uses the Vite proxy prefix in development", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ registration: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const devClient = createDashboardApi(undefined, {
        baseUrl: resolveDashboardApiBaseUrl({ isDev: true }),
      });
      await devClient.getRegistration();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([{ url: "/api/registration", method: "GET" }]);
  });

  test("uses root-mounted Hono routes outside development", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ registration: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const api = createDashboardApi(undefined, {
        baseUrl: resolveDashboardApiBaseUrl({ isDev: false }),
      });
      await api.getRegistration();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([{ url: "/registration", method: "GET" }]);
  });
});

describe("media helpers", () => {
  test("maps known module blueprint ids to distinct light and dark artwork", () => {
    const commandLight = getModuleArtwork("command-module", "light");
    const commandDark = getModuleArtwork("command-module", "dark");
    const suitportLight = getModuleArtwork("basic-suitport", "light");

    expect(commandLight).not.toBeNull();
    expect(commandDark).not.toBeNull();
    expect(suitportLight).not.toBeNull();
    if (!commandLight || !commandDark || !suitportLight) {
      throw new Error("Expected known blueprint artwork.");
    }
    expect(commandLight.src).toContain("10_17_11");
    expect(commandDark.src).toContain("10_17_13");
    expect(commandLight.src).not.toBe(commandDark.src);
    expect(suitportLight.src).toContain("10_17_21");
  });

  test("uses the generic human avatar unless an explicit override exists", () => {
    expect(humanAvatarOverrides["human-2"]).toBe("male");
    expect(getHumanAvatarVariant("human-2")).toBe("male");
    expect(getHumanAvatarVariant("human-999")).toBe("generic");
  });
});
