import { ApiError } from "../api/client";
import { Hono } from "hono";
import {
  addInventoryResource,
  advanceTicks,
  cancelConstructionForHabitat,
  getOfficialBlueprint,
  getSolarIrradiance,
  getRegistration,
  getStatus,
  isHabitatServiceClientError,
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
  scanWorld,
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
  scanWorld?: (input: {
    x: number;
    y: number;
    sensorStrength: number;
    radiusTiles: number;
  }) => Promise<unknown>;
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
  const scanWorldHandler = options.scanWorld ?? ((input: {
    x: number;
    y: number;
    sensorStrength: number;
    radiusTiles: number;
  }) => scanWorld(cwd, input));
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
    return c.json({ registration: toPublicRegistration(registration) });
  });

  app.post("/registration", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { displayName?: string };
    if (!body.displayName?.trim()) {
      return c.json({ error: { message: "Missing display name." } }, 400);
    }

    try {
      const result = (await register(body.displayName)) as RegistrationResult;
      return c.json({ ...result, registration: toPublicRegistration(result.registration) }, 201);
    } catch (error) {
      return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 400);
    }
  });

  app.get("/status", async (c) => {
    try {
      const result = (await readStatus()) as StatusResult;
      return c.json({ ...result, registration: toPublicRegistration(result.registration) });
    } catch (error) {
      return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 404);
    }
  });

  app.delete("/registration", async (c) => {
    try {
      const registration = (await unregister()) as BackendRegistration;
      return c.json({ registration: toPublicRegistration(registration) });
    } catch (error) {
      return c.json({ error: { message: error instanceof Error ? error.message : String(error) } }, 404);
    }
  });

  app.get("/catalog/blueprints", async (c) => {
    const result = await readBlueprints();
    return c.json(result);
  });

  app.get("/catalog/blueprints/:blueprintId", async (c) => {
    const blueprintId = c.req.param("blueprintId");
    try {
      const result = await readBlueprint(blueprintId);
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
    return c.json(result);
  });

  app.get("/solar/irradiance", async (c) => {
    const result = await readSolar();
    return c.json(result);
  });

  app.get("/scan", async (c) => {
    const xValue = c.req.query("x");
    const yValue = c.req.query("y");
    const sensorStrengthValue = c.req.query("sensorStrength");
    const radiusTilesValue = c.req.query("radiusTiles");

    const parsedX = parseRequiredIntegerQuery(xValue, "x");
    if ("error" in parsedX) return c.json({ error: { message: parsedX.error } }, 400);

    const parsedY = parseRequiredIntegerQuery(yValue, "y");
    if ("error" in parsedY) return c.json({ error: { message: parsedY.error } }, 400);

    const parsedSensorStrength = parseRequiredIntegerInRangeQuery(
      sensorStrengthValue,
      "sensorStrength",
      0,
      100,
      'Invalid sensorStrength "%s". Use an integer from 0 through 100.',
    );
    if ("error" in parsedSensorStrength) return c.json({ error: { message: parsedSensorStrength.error } }, 400);

    const parsedRadiusTiles = parseRequiredIntegerInRangeQuery(
      radiusTilesValue,
      "radiusTiles",
      0,
      5,
      'Invalid radiusTiles "%s". Use an integer from 0 through 5.',
    );
    if ("error" in parsedRadiusTiles) return c.json({ error: { message: parsedRadiusTiles.error } }, 400);

    try {
      const result = await scanWorldHandler({
        x: parsedX.value,
        y: parsedY.value,
        sensorStrength: parsedSensorStrength.value,
        radiusTiles: parsedRadiusTiles.value,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonErrorResponse(error.message, error.status);
      }
      if (isHabitatServiceClientError(error)) {
        return jsonErrorResponse(error.message, error.status);
      }
      if (error instanceof Error && error.message === "No habitat registration found.") {
        return c.json({ error: { message: error.message } }, 404);
      }
      throw error;
    }
  });

  app.get("/modules", async (c) => {
    const modules = (await readModules()) as Array<unknown>;
    return c.json(modules);
  });

  app.get("/modules/status", async (c) => {
    const result = (await readModulePowerStatus()) as { rows: Array<unknown> };
    return c.json(result);
  });

  app.get("/modules/:moduleReference", async (c) => {
    const result = (await readModule(c.req.param("moduleReference"))) as unknown;
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
    return c.json(result);
  });

  app.delete("/modules/:moduleReference", async (c) => {
    const result = (await deleteModuleHandler(c.req.param("moduleReference"))) as { id: string };
    return c.json(result);
  });

  app.put("/modules/:moduleReference/status", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { status?: unknown };
    const result = (await setModuleStatusHandler(c.req.param("moduleReference"), body.status)) as { currentPowerDrawKw?: number };
    return c.json(result);
  });

  app.get("/inventory", async (c) => {
    const inventory = (await readInventory()) as Array<unknown>;
    return c.json(inventory);
  });

  app.post("/inventory", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { resourceType?: unknown; quantity?: unknown };
    if (typeof body.resourceType !== "string" || typeof body.quantity !== "number") {
      return c.json({ error: { message: "Missing inventory fields." } }, 400);
    }
    const result = (await addInventoryHandler(body.resourceType, body.quantity)) as { quantity: number; resourceType: string };
    return c.json(result, 201);
  });

  app.delete("/inventory", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { resourceType?: unknown; quantity?: unknown };
    if (typeof body.resourceType !== "string" || typeof body.quantity !== "number") {
      return c.json({ error: { message: "Missing inventory fields." } }, 400);
    }
    const result = (await removeInventoryHandler(body.resourceType, body.quantity)) as { quantity: number; resourceType: string };
    return c.json(result);
  });

  app.post("/ticks", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { count?: unknown };
    if (typeof body.count !== "number" || !Number.isInteger(body.count) || body.count <= 0) {
      return c.json({ error: { message: "Invalid tick count. Use a positive integer." } }, 400);
    }
    const result = await advanceTicksHandler(body.count);
    return c.json(result);
  });

  app.post("/construction/plan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { blueprintId?: unknown };
    if (typeof body.blueprintId !== "string" || !body.blueprintId.trim()) {
      return c.json({ error: { message: "Missing blueprint id." } }, 400);
    }
    const result = await planConstructionHandler(body.blueprintId);
    return c.json(result);
  });

  app.post("/construction", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { blueprintId?: unknown };
    if (typeof body.blueprintId !== "string" || !body.blueprintId.trim()) {
      return c.json({ error: { message: "Missing blueprint id." } }, 400);
    }
    const result = await startConstructionHandler(body.blueprintId);
    return c.json(result, 201);
  });

  app.get("/construction", async (c) => {
    const result = await listConstructionJobsHandler();
    return c.json(result);
  });

  app.delete("/construction/:moduleReference", async (c) => {
    const result = await cancelConstructionHandler(c.req.param("moduleReference"));
    return c.json(result);
  });

  return app;
}

function toPublicRegistration(registration: BackendRegistration | null): PublicRegistration | null {
  if (!registration) {
    return null;
  }

  const { apiToken: _apiToken, ...publicRegistration } = registration;
  return publicRegistration;
}

function parseRequiredIntegerQuery(
  value: string | undefined,
  field: "x" | "y",
): { value: number; error?: undefined } | { value?: undefined; error: string } {
  if (value === undefined || value.trim() === "") {
    return { error: `Missing ${field}.` };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return { error: `Invalid ${field} "${value}". Use an integer.` };
  }

  return { value: parsed };
}

function parseRequiredIntegerInRangeQuery(
  value: string | undefined,
  field: "sensorStrength" | "radiusTiles",
  minimum: number,
  maximum: number,
  template: string,
): { value: number; error?: undefined } | { value?: undefined; error: string } {
  if (value === undefined || value.trim() === "") {
    return { error: `Missing ${field}.` };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return { error: template.replace("%s", value) };
  }

  return { value: parsed };
}

function jsonErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
