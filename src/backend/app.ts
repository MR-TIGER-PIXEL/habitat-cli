import { Hono } from "hono";
import {
  addInventoryResource,
  advanceTicks,
  cancelConstructionForHabitat,
  getOfficialBlueprint,
  getSolarIrradiance,
  getRegistration,
  getStatus,
  createModule,
  deleteModule,
  getModule,
  getModulePowerStatus,
  listOfficialBlueprints,
  listOfficialResources,
  listConstructionJobs,
  listInventory,
  listModules,
  registerHabitat,
  removeInventoryResource,
  planConstructionForHabitat,
  setModuleStatus,
  startConstructionForHabitat,
  updateModule,
  unregisterHabitat,
} from "./habitat-service";
import type { BackendRegistration } from "./registration-store";

type PublicRegistration = Omit<BackendRegistration, "apiToken">;
type RegistrationResult = {
  registration: BackendRegistration;
  response: unknown;
};
type StatusResult = {
  registration: BackendRegistration;
  habitat: unknown;
  moduleCount: number;
  currentTick: number;
};

export type BackendAppOptions = {
  cwd?: string;
  readRegistration?: () => Promise<BackendRegistration | null> | BackendRegistration | null;
  getRegistration?: () => Promise<BackendRegistration | null> | BackendRegistration | null;
  registerHabitat?: (displayName: string) => Promise<unknown>;
  getStatus?: () => Promise<unknown>;
  unregisterHabitat?: () => Promise<unknown>;
  listOfficialBlueprints?: () => Promise<unknown>;
  getOfficialBlueprint?: (blueprintId: string) => Promise<unknown>;
  listOfficialResources?: () => Promise<unknown>;
  getSolarIrradiance?: () => Promise<unknown>;
  listModules?: () => Promise<unknown>;
  getModule?: (moduleReference: string) => Promise<unknown>;
  createModule?: (input: unknown) => Promise<unknown>;
  updateModule?: (moduleReference: string, input: unknown) => Promise<unknown>;
  deleteModule?: (moduleReference: string) => Promise<unknown>;
  setModuleStatus?: (moduleReference: string, status: unknown) => Promise<unknown>;
  getModulePowerStatus?: () => Promise<unknown>;
  listInventory?: () => Promise<unknown>;
  addInventoryResource?: (resourceType: string, quantity: number) => Promise<unknown>;
  removeInventoryResource?: (resourceType: string, quantity: number) => Promise<unknown>;
  advanceTicks?: (count: number) => Promise<unknown>;
  planConstruction?: (blueprintId: string) => unknown;
  startConstruction?: (blueprintId: string) => Promise<unknown>;
  listConstructionJobs?: () => unknown;
  cancelConstruction?: (moduleReference: string) => unknown;
};

export function createApp(options: BackendAppOptions = {}): Hono {
  const app = new Hono();
  const cwd = options.cwd ?? process.cwd();
  const readRegistration =
    options.readRegistration ?? options.getRegistration ?? (() => getRegistration(cwd));
  const register = options.registerHabitat ?? ((displayName: string) => registerHabitat(cwd, displayName));
  const readStatus = options.getStatus ?? (() => getStatus(cwd));
  const unregister = options.unregisterHabitat ?? (() => unregisterHabitat(cwd));
  const readBlueprints = options.listOfficialBlueprints ?? (() => listOfficialBlueprints());
  const readBlueprint = options.getOfficialBlueprint ?? ((blueprintId: string) => getOfficialBlueprint(blueprintId));
  const readResources = options.listOfficialResources ?? (() => listOfficialResources());
  const readSolar = options.getSolarIrradiance ?? (() => getSolarIrradiance());
  const readModules = options.listModules ?? (() => listModules(cwd));
  const readModule = options.getModule ?? ((moduleReference: string) => getModule(cwd, moduleReference));
  const createModuleHandler = options.createModule ?? ((input: unknown) => createModule(cwd, input as never));
  const updateModuleHandler = options.updateModule ?? ((moduleReference: string, input: unknown) => updateModule(cwd, moduleReference, input as never));
  const deleteModuleHandler = options.deleteModule ?? ((moduleReference: string) => deleteModule(cwd, moduleReference));
  const setModuleStatusHandler = options.setModuleStatus ?? ((moduleReference: string, status: unknown) => setModuleStatus(cwd, moduleReference, status as never));
  const readModulePowerStatus = options.getModulePowerStatus ?? (() => getModulePowerStatus(cwd));
  const readInventory = options.listInventory ?? (() => listInventory(cwd));
  const addInventoryHandler = options.addInventoryResource ?? ((resourceType: string, quantity: number) => addInventoryResource(cwd, resourceType, quantity));
  const removeInventoryHandler = options.removeInventoryResource ?? ((resourceType: string, quantity: number) => removeInventoryResource(cwd, resourceType, quantity));
  const advanceTicksHandler = options.advanceTicks ?? ((count: number) => advanceTicks(cwd, count));
  const planConstructionHandler = options.planConstruction ?? ((blueprintId: string) => planConstructionForHabitat(cwd, blueprintId));
  const startConstructionHandler = options.startConstruction ?? ((blueprintId: string) => startConstructionForHabitat(cwd, blueprintId));
  const listConstructionJobsHandler = options.listConstructionJobs ?? (() => listConstructionJobs(cwd));
  const cancelConstructionHandler = options.cancelConstruction ?? ((moduleReference: string) => cancelConstructionForHabitat(cwd, moduleReference));

  app.get("/registration", async (c) => {
    const registration = await readRegistration();
    logHabitatApi("GET", "/registration", registration ? "registered" : "not registered");
    return c.json({ registration: toPublicRegistration(registration) });
  });

  app.post("/registration", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: string };
    if (!body.displayName?.trim()) {
      return c.json({ error: { message: "Missing display name." } }, 400);
    }

    try {
      const result = (await register(body.displayName)) as RegistrationResult;
      logHabitatApi("POST", "/registration", "registered habitat");
      return c.json({ ...result, registration: toPublicRegistration(result.registration) }, 201);
    } catch (error) {
      return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 400);
    }
  });

  app.get("/status", async (c) => {
    try {
      const result = (await readStatus()) as StatusResult;
      logHabitatApi("GET", "/status", "returned status");
      return c.json({ ...result, registration: toPublicRegistration(result.registration) });
    } catch (error) {
      return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 404);
    }
  });

  app.delete("/registration", async (c) => {
    try {
      const registration = (await unregister()) as BackendRegistration;
      logHabitatApi("DELETE", "/registration", "deleted registration");
      return c.json({ registration: toPublicRegistration(registration) });
    } catch (error) {
      return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 404);
    }
  });

  app.get("/catalog/blueprints", async (c) => {
    const result = await readBlueprints();
    logHabitatApi("GET", "/catalog/blueprints", "proxied to Kepler");
    return c.json(result);
  });

  app.get("/catalog/blueprints/:blueprintId", async (c) => {
    const blueprintId = c.req.param("blueprintId");
    try {
      const result = await readBlueprint(blueprintId);
      logHabitatApi("GET", "/catalog/blueprints/:blueprintId", "proxied to Kepler");
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("No blueprint with that id")) {
        return c.json({
          error: { message: `Blueprint "${blueprintId}" was not found in the Kepler catalog.` },
        }, 404);
      }
      throw error;
    }
  });

  app.get("/catalog/resources", async (c) => {
    const result = await readResources();
    logHabitatApi("GET", "/catalog/resources", "proxied to Kepler");
    return c.json(result);
  });

  app.get("/solar/irradiance", async (c) => {
    const result = await readSolar();
    logHabitatApi("GET", "/solar/irradiance", "proxied to Kepler");
    return c.json(result);
  });

  app.get("/modules", async (c) => {
    const modules = (await readModules()) as Array<unknown>;
    logHabitatApi("GET", "/modules", `${modules.length} modules`);
    return c.json(modules);
  });

  app.get("/modules/status", async (c) => {
    const result = (await readModulePowerStatus()) as { rows: Array<unknown> };
    logHabitatApi("GET", "/modules/status", `${result.rows.length} modules`);
    return c.json(result);
  });

  app.get("/modules/:moduleReference", async (c) => {
    const result = (await readModule(c.req.param("moduleReference"))) as unknown;
    logHabitatApi("GET", "/modules/:moduleReference", "returned module details");
    return c.json(result);
  });

  app.post("/modules", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (
      typeof body.id !== "string"
      || typeof body.blueprintId !== "string"
      || typeof body.displayName !== "string"
    ) {
      return c.json({ error: { message: "Missing module fields." } }, 400);
    }

    const result = (await createModuleHandler({
      id: body.id,
      blueprintId: body.blueprintId,
      displayName: body.displayName,
      connectedTo: Array.isArray(body.connectedTo) ? body.connectedTo : undefined,
      runtimeAttributes:
        body.runtimeAttributes && typeof body.runtimeAttributes === "object" && !Array.isArray(body.runtimeAttributes)
          ? body.runtimeAttributes
          : undefined,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
    })) as { id: string };
    logHabitatApi("POST", "/modules", `created module ${result.id}`);
    return c.json(result, 201);
  });

  app.put("/modules/:moduleReference", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = (await updateModuleHandler(c.req.param("moduleReference"), {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      connectedTo: Array.isArray(body.connectedTo) ? body.connectedTo : undefined,
      runtimeAttributes:
        body.runtimeAttributes && typeof body.runtimeAttributes === "object" && !Array.isArray(body.runtimeAttributes)
          ? body.runtimeAttributes
          : undefined,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
    })) as unknown;
    logHabitatApi("PUT", "/modules/:moduleReference", "updated module");
    return c.json(result);
  });

  app.delete("/modules/:moduleReference", async (c) => {
    const result = (await deleteModuleHandler(c.req.param("moduleReference"))) as { id: string };
    logHabitatApi("DELETE", "/modules/:moduleReference", `deleted module ${result.id}`);
    return c.json(result);
  });

  app.put("/modules/:moduleReference/status", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { status?: unknown };
    const result = (await setModuleStatusHandler(c.req.param("moduleReference"), body.status)) as { currentPowerDrawKw?: number };
    logHabitatApi("PUT", "/modules/:moduleReference/status", "updated module status");
    return c.json(result);
  });

  app.get("/inventory", async (c) => {
    const inventory = (await readInventory()) as Array<unknown>;
    logHabitatApi("GET", "/inventory", `${inventory.length} inventory entries`);
    return c.json(inventory);
  });

  app.post("/inventory", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { resourceType?: unknown; quantity?: unknown };
    if (typeof body.resourceType !== "string" || typeof body.quantity !== "number") {
      return c.json({ error: { message: "Missing inventory fields." } }, 400);
    }
    const result = (await addInventoryHandler(body.resourceType, body.quantity)) as { quantity: number; resourceType: string };
    logHabitatApi("POST", "/inventory", `added ${result.quantity} of ${result.resourceType}`);
    return c.json(result, 201);
  });

  app.delete("/inventory", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { resourceType?: unknown; quantity?: unknown };
    if (typeof body.resourceType !== "string" || typeof body.quantity !== "number") {
      return c.json({ error: { message: "Missing inventory fields." } }, 400);
    }
    const result = (await removeInventoryHandler(body.resourceType, body.quantity)) as { quantity: number; resourceType: string };
    logHabitatApi("DELETE", "/inventory", `removed ${body.quantity} of ${result.resourceType}`);
    return c.json(result);
  });

  app.post("/ticks", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { count?: unknown };
    if (typeof body.count !== "number" || !Number.isInteger(body.count) || body.count <= 0) {
      return c.json({ error: { message: "Invalid tick count. Use a positive integer." } }, 400);
    }
    const result = await advanceTicksHandler(body.count);
    logHabitatApi("POST", "/ticks", `advanced ${body.count} ticks`);
    return c.json(result);
  });

  app.post("/construction/plan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { blueprintId?: unknown };
    if (typeof body.blueprintId !== "string" || !body.blueprintId.trim()) {
      return c.json({ error: { message: "Missing blueprint id." } }, 400);
    }
    const result = await planConstructionHandler(body.blueprintId);
    logHabitatApi("POST", "/construction/plan", "planned construction");
    return c.json(result);
  });

  app.post("/construction", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { blueprintId?: unknown };
    if (typeof body.blueprintId !== "string" || !body.blueprintId.trim()) {
      return c.json({ error: { message: "Missing blueprint id." } }, 400);
    }
    const result = await startConstructionHandler(body.blueprintId);
    logHabitatApi("POST", "/construction", "started construction");
    return c.json(result, 201);
  });

  app.get("/construction", async (c) => {
    const result = await listConstructionJobsHandler();
    logHabitatApi("GET", "/construction", `${(result as unknown[]).length} active jobs`);
    return c.json(result);
  });

  app.delete("/construction/:moduleReference", async (c) => {
    const result = await cancelConstructionHandler(c.req.param("moduleReference"));
    logHabitatApi("DELETE", "/construction/:moduleReference", "canceled construction");
    return c.json(result);
  });

  return app;
}

function logHabitatApi(method: string, route: string, summary: string): void {
  console.log(`[habitat-api] ${method} ${route} -> ${summary}`);
}

function toPublicRegistration(registration: BackendRegistration | null): PublicRegistration | null {
  if (!registration) {
    return null;
  }

  const { apiToken: _apiToken, ...publicRegistration } = registration;
  return publicRegistration;
}
