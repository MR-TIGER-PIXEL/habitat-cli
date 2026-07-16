import { expect, test } from "bun:test";
import type { WebSocketLike } from "./kepler-stream-client";
import { createClockStreamController } from "./clock-stream-controller";

class FakeWebSocket implements WebSocketLike {
  readonly url: string;
  readyState = 1;
  closeCalls = 0;
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(_data: string): void {}

  close(): void {
    this.closeCalls += 1;
  }

  emitMessage(data: string): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data });
    }
  }

  emitClose(): void {
    for (const listener of this.listeners.get("close") ?? []) {
      listener();
    }
  }

  emitOpen(): void {
    for (const listener of this.listeners.get("open") ?? []) {
      listener();
    }
  }
}

class FakeScheduler {
  readonly handles = new Map<number, () => void>();
  nextId = 1;

  setTimeout(callback: () => void): unknown {
    const id = this.nextId++;
    this.handles.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.handles.delete(handle);
    }
  }
}

test("repeated controller start does not create duplicate sockets", () => {
  const sockets: FakeWebSocket[] = [];
  const controller = createClockStreamController({
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  const input = {
    registration: {
      habitatId: "habitat-1",
      apiToken: "secret",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "running",
      },
    },
    onAcknowledged: (_habitatId: string) => {},
    onUnexpectedDisconnect: () => {},
    onPlanetTick: async () => {},
  };

  controller.start(input);
  controller.start(input);

  expect(sockets).toHaveLength(1);
});

test("controller stop closes the socket and clears reconnect attempts", async () => {
  const sockets: FakeWebSocket[] = [];
  const scheduler = new FakeScheduler();
  const controller = createClockStreamController({
    scheduler,
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  controller.start({
    registration: {
      habitatId: "habitat-1",
      apiToken: "secret",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "running",
      },
    },
    onAcknowledged: (_habitatId: string) => {},
    onUnexpectedDisconnect: () => {},
    onPlanetTick: async () => {},
  });

  const scheduledController = createClockStreamController({
    scheduler,
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  scheduledController.start({
    registration: {
      habitatId: "habitat-1",
      apiToken: "secret",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "running",
      },
    },
    onAcknowledged: (_habitatId: string) => {},
    onUnexpectedDisconnect: () => {},
    onPlanetTick: async () => {},
  });
  sockets[1]?.emitClose();
  expect(scheduler.handles.size).toBe(1);

  await controller.stop();
  await scheduledController.stop();

  expect(sockets[0]?.closeCalls).toBe(1);
  expect(scheduler.handles.size).toBe(0);
});

test("controller stop waits for in-progress tick work", async () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  let releaseTick: (() => void) | undefined;
  const controller = createClockStreamController({
    createSocket() {
      return socket;
    },
  });

  controller.start({
    registration: {
      habitatId: "habitat-1",
      apiToken: "secret",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "running",
      },
    },
    onAcknowledged: (_habitatId: string) => {},
    onUnexpectedDisconnect: () => {},
    onPlanetTick: () => new Promise<void>((resolve) => {
      releaseTick = resolve;
    }),
  });

  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-1" }));
  socket.emitMessage(JSON.stringify({ type: "planet_tick", tick: 7, advancedBy: 2 }));

  let stopped = false;
  const stopping = controller.stop().then(() => {
    stopped = true;
  });

  expect(stopped).toBe(false);
  if (releaseTick !== undefined) {
    releaseTick();
  }
  await stopping;
  expect(stopped).toBe(true);
});
