import { readFileSync } from "node:fs";
import path from "node:path";
import { createApp } from "./backend/app";

type Fixture = {
  status: number;
  body: unknown;
};

type ClockEventFixture = {
  event?: unknown;
  raw?: string;
};

const rawFixtures = process.env.HABITAT_TEST_FETCH_FIXTURES;
const fixtures = rawFixtures
  ? JSON.parse(rawFixtures) as Record<string, Fixture>
  : {};
const rawClockEvents = process.env.HABITAT_TEST_CLOCK_EVENTS;
const clockEvents = rawClockEvents
  ? JSON.parse(rawClockEvents) as ClockEventFixture[]
  : null;
const backend = createApp({ cwd: process.cwd() });

const mockedFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => {
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (clockEvents && method === "GET" && url === "http://localhost:8787/clock/events") {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const item of clockEvents) {
            const payload = item.raw ?? `data: ${JSON.stringify(item.event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          }
          controller.close();
        },
      }), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    }

    if (url.startsWith("http://localhost:8787")) {
      return backend.fetch(new Request(url, init));
    }

    const fixture = fixtures[`${method} ${url}`] ?? defaultFixture(url, method);
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status,
      headers: { "content-type": "application/json" },
    });
  },
  { preconnect: fetch.preconnect.bind(fetch) },
) as typeof fetch;

globalThis.fetch = mockedFetch;

function defaultFixture(url: string, method: string): Fixture {
  if (method === "GET" && url.includes("/catalog/blueprints/")) {
    const blueprintId = decodeURIComponent(url.split("/").pop() ?? "");
    const blueprints = readBlueprints();
    return { status: 200, body: { blueprint: blueprints[blueprintId] ?? null } };
  }

  if (method === "GET" && url.endsWith("/catalog/blueprints")) {
    const blueprints = Object.values(readBlueprints());
    return { status: 200, body: { catalogVersion: "test", blueprints } };
  }

  if (method === "GET" && url.endsWith("/catalog/resources")) {
    return { status: 200, body: { catalogVersion: "test", resources: [] } };
  }

  if (method === "GET" && url.endsWith("/world/solar-irradiance")) {
    return { status: 200, body: { irradianceWPerM2: 800, condition: "clear" } };
  }

  if (method === "GET" && url.includes("/world/sectors/current")) {
    return {
      status: 200,
      body: {
        sector: {
          id: "kepler-442b-local-001",
          displayName: "Kepler-442b Local Survey Grid",
          origin: { x: 0, y: 0 },
          bounds: {
            minX: -25,
            maxX: 24,
            minY: -25,
            maxY: 24,
          },
          tileSizeMeters: 100,
          supportedTerrains: ["flat"],
        },
      },
    };
  }

  if (method === "GET" && url.includes("/habitats/") && url.endsWith("/registration")) {
    return {
      status: 200,
      body: {
        habitat: {
          habitatSlug: "test-habitat",
          status: "online",
          catalogVersion: "test",
          lastSeenAt: null,
        },
      },
    };
  }

  if (method === "POST" && url.endsWith("/habitats/register")) {
    return { status: 201, body: { habitatId: "test-habitat", starterModules: [], blueprints: [] } };
  }

  return { status: 200, body: {} };
}

function readBlueprints(): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), ".habitat", "blueprints.json"), "utf8"));
  } catch {
    return {};
  }
}
