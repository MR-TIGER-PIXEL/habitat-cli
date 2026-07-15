import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../api/client";
import {
  createDashboardApi,
  loadDashboardData,
  registerHabitat,
  resolveDashboardApiBaseUrl,
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
  ],
  powerStatus: {
    rows: [
      {
        displayName: "Command Module",
        declaredStatus: "active",
        effectiveState: "active",
        currentPowerDrawKw: 3.5,
      },
    ],
    totalCurrentPowerDrawKw: 3.5,
    oneTickEnergyCostKwh: 0.00097,
  },
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
    });

    const result = await loadDashboardData(api);

    expect(result.kind).toBe("registered");
    if (result.kind !== "registered") {
      throw new Error("Expected registered dashboard data");
    }
    expect(result.modules[0]?.displayName).toBe("Command Module");
    expect(result.powerStatus.rows[0]?.currentPowerDrawKw).toBe(3.5);
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
    });

    const result = await registerHabitat(api, "Artemis Ridge");

    expect(result.kind).toBe("registered");
    expect(calls).toEqual([
      "register:Artemis Ridge",
      "getRegistration",
      "getStatus",
      "listModules",
      "getModulePowerStatus",
    ]);
  });
});

describe("DashboardApp", () => {
  test("renders the registration CTA when no habitat is registered", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        model={unregisteredModel}
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
        model={registeredModel}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue=""
        latestTickResult={latestTickResult}
        solarIrradiance={{ irradianceWPerM2: 712, condition: "clear" }}
      />,
    );

    expect(html).toContain("Command Module");
    expect(html).toContain("3.50 kW");
    expect(html).toContain("Module status");
    expect(html).toContain("Habitat Overview");
    expect(html).toContain("Advance simulation");
    expect(html).toContain("Net power");
  });

  test("renders a destructive confirmation state before unregistering", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        model={{ ...registeredModel, confirmUnregister: true }}
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
        model={registeredModel}
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
        model={registeredModel}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue="0"
        tickInputError="Use a positive whole number."
      />,
    );

    expect(html).toContain("Use a positive whole number.");
  });

  test("enables tick controls for registered habitats", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        model={registeredModel}
        mode="dark"
        registrationName="Artemis Ridge"
        lastRefreshLabel="11:24 AM"
        tickInputValue="12"
      />,
    );

    expect(html).toContain(">1 tick<");
    expect(html).toContain(">Run custom ticks<");
    expect(html).not.toContain('button "1 tick" [disabled]');
    expect(html).not.toContain('button "Run custom ticks" [disabled]');
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
