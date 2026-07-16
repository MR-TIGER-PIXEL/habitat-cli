import { expect, test } from "bun:test";
import { consumeClockEventStream, createBackendApiClient } from "./backend-api";

test("consumeClockEventStream safely ignores malformed local SSE data", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode("data: {bad-json}\n\n"));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        tick: 42,
        advancedBy: 3,
        issuedAt: "2026-07-16T15:05:00Z",
        applied: true,
        previousTick: 39,
      })}\n\n`));
      controller.close();
    },
  });

  const events: unknown[] = [];
  await consumeClockEventStream(body, (event) => events.push(event));

  expect(events).toEqual([{
    tick: 42,
    advancedBy: 3,
    issuedAt: "2026-07-16T15:05:00Z",
    applied: true,
    previousTick: 39,
  }]);
});

test("watchClockEvents aborts only the local watch request", async () => {
  let aborted = false;
  const fetchImpl = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
    }, { once: true });
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          tick: 42,
          advancedBy: 3,
          issuedAt: "2026-07-16T15:05:00Z",
          applied: true,
          previousTick: 39,
        })}\n\n`));
      },
      cancel() {
        return;
      },
    }), {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }, { preconnect: () => {} }) as typeof fetch;

  const api = createBackendApiClient({
    baseUrl: "http://localhost:8787",
    fetchImpl,
  });

  const controller = new AbortController();
  const events: unknown[] = [];
  const watching = api.watchClockEvents({
    signal: controller.signal,
    onEvent(event) {
      events.push(event);
      controller.abort();
    },
  });

  await watching;

  expect(events).toEqual([{
    tick: 42,
    advancedBy: 3,
    issuedAt: "2026-07-16T15:05:00Z",
    applied: true,
    previousTick: 39,
  }]);
  expect(aborted).toBe(true);
});
