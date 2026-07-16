import { expect, test } from "bun:test";
import {
  createKeplerStreamClient,
  type KeplerStreamRegistration,
  type LoggerLike,
  type SchedulerLike,
  type WebSocketLike,
} from "./kepler-stream-client";

class FakeWebSocket implements WebSocketLike {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  sentMessages: string[] = [];
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

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  emitOpen(): void {
    this.emit("open");
  }

  emitMessage(data: string): void {
    this.emit("message", { data });
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeScheduler implements SchedulerLike {
  private nextHandle = 1;
  readonly scheduled = new Map<number, { delayMs: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.scheduled.set(handle, { delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.scheduled.delete(handle);
    }
  }

  runNext(): void {
    const [handle, entry] = this.scheduled.entries().next().value as [number, {
      delayMs: number;
      callback: () => void;
    }];
    this.scheduled.delete(handle);
    entry.callback();
  }
}

function createLogger(): { logger: LoggerLike; lines: string[] } {
  const lines: string[] = [];
  const push = (level: string, message: string) => {
    lines.push(`${level}:${message}`);
  };

  return {
    lines,
    logger: {
      info(message: string) {
        push("info", message);
      },
      warn(message: string) {
        push("warn", message);
      },
      error(message: string) {
        push("error", message);
      },
    },
  };
}

function createRegistration(overrides: Partial<KeplerStreamRegistration> = {}): KeplerStreamRegistration {
  return {
    habitatId: "habitat-123",
    apiToken: "secret-stream-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks", "alerts"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    ...overrides,
  };
}

test("opens the saved stream URL", () => {
  const sockets: FakeWebSocket[] = [];
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  client.start();

  expect(sockets).toHaveLength(1);
  expect(sockets[0]?.url).toBe("wss://planet.turingguild.com/planet/stream");
});

test("does not put the token in the URL", () => {
  const sockets: FakeWebSocket[] = [];
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  client.start();

  expect(sockets[0]?.url).toBe("wss://planet.turingguild.com/planet/stream");
  expect(sockets[0]?.url.includes("secret-stream-token")).toBe(false);
  expect(sockets[0]?.url.includes("apiToken=")).toBe(false);
});

test("sends the authenticated hello after the socket opens", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
  });

  client.start();
  socket.emitOpen();

  expect(socket.sentMessages).toEqual([
    JSON.stringify({
      type: "hello",
      apiToken: "secret-stream-token",
      subscribe: ["ticks"],
    }),
  ]);
});

test("uses only advertised supported subscriptions", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const client = createKeplerStreamClient({
    registration: createRegistration({
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["alerts", "ticks", "unknown"],
        currentTick: 0,
        ticksPerPulse: 1,
        status: "running",
      },
    }),
    createSocket() {
      return socket;
    },
  });

  client.start();
  socket.emitOpen();

  expect(JSON.parse(socket.sentMessages[0] ?? "")).toEqual({
    type: "hello",
    apiToken: "secret-stream-token",
    subscribe: ["ticks"],
  });
});

test("accepts a valid hello_ack", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const acknowledgements: string[] = [];
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    onAcknowledged(habitatId) {
      acknowledgements.push(habitatId);
    },
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-123" }));

  expect(client.isAcknowledged()).toBe(true);
  expect(acknowledgements).toEqual(["habitat-123"]);
});

test("rejects a mismatched Habitat ID", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const { logger, lines } = createLogger();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    logger,
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-999" }));

  expect(client.isAcknowledged()).toBe(false);
  expect(socket.closeCalls).toBe(1);
  expect(lines.join("\n")).toContain("warn:Received hello_ack for the wrong habitat.");
});

test("ignores ticks before acknowledgement", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const ticks: Array<{ tick: number; advancedBy: number; previousTick?: number; issuedAt?: string }> = [];
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    onPlanetTick(notice) {
      ticks.push(notice);
    },
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage(JSON.stringify({ type: "planet_tick", tick: 5, advancedBy: 2 }));

  expect(ticks).toEqual([]);
});

test("safely handles malformed JSON", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const { logger, lines } = createLogger();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    logger,
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage("{not-json");

  expect(lines.join("\n")).toContain("warn:Received malformed JSON from the Kepler stream.");
  expect(client.isAcknowledged()).toBe(false);
});

test("rejects invalid advancedBy", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const ticks: Array<{ tick: number; advancedBy: number }> = [];
  const { logger, lines } = createLogger();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    logger,
    onPlanetTick(notice) {
      ticks.push(notice);
    },
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-123" }));
  socket.emitMessage(JSON.stringify({ type: "planet_tick", tick: 7, advancedBy: 0 }));

  expect(ticks).toEqual([]);
  expect(lines.join("\n")).toContain("warn:Ignoring planet_tick with invalid advancedBy.");
});

test("passes through previousTick and issuedAt for valid planet_tick messages", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const ticks: Array<{ tick: number; advancedBy: number; previousTick?: number; issuedAt?: string }> = [];
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    onPlanetTick(notice) {
      ticks.push(notice);
    },
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-123" }));
  socket.emitMessage(JSON.stringify({
    type: "planet_tick",
    previousTick: 800,
    tick: 900,
    advancedBy: 100,
    issuedAt: "2026-07-15T14:30:00.000Z",
  }));

  expect(ticks).toEqual([
    {
      previousTick: 800,
      tick: 900,
      advancedBy: 100,
      issuedAt: "2026-07-15T14:30:00.000Z",
    },
  ]);
});

test("rejects invalid absolute tick values", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const ticks: Array<{ tick: number; advancedBy: number }> = [];
  const { logger, lines } = createLogger();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    logger,
    onPlanetTick(notice) {
      ticks.push(notice);
    },
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-123" }));
  socket.emitMessage(JSON.stringify({ type: "planet_tick", tick: -1, advancedBy: 2 }));
  socket.emitMessage(JSON.stringify({ type: "planet_tick", tick: 1.5, advancedBy: 2 }));

  expect(ticks).toEqual([]);
  expect(lines.join("\n")).toContain("warn:Ignoring planet_tick with invalid tick.");
});

test("schedules reconnect after unexpected disconnect", () => {
  const sockets: FakeWebSocket[] = [];
  const scheduler = new FakeScheduler();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    scheduler,
    reconnectDelayMs: 250,
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  client.start();
  sockets[0]?.emitClose();

  expect(scheduler.scheduled.size).toBe(1);
  expect([...scheduler.scheduled.values()][0]?.delayMs).toBe(250);

  scheduler.runNext();

  expect(sockets).toHaveLength(2);
});

test("avoids duplicate reconnect timers or sockets", () => {
  const sockets: FakeWebSocket[] = [];
  const scheduler = new FakeScheduler();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    scheduler,
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  client.start();
  client.start();
  sockets[0]?.emitClose();
  sockets[0]?.emitClose();

  expect(sockets).toHaveLength(1);
  expect(scheduler.scheduled.size).toBe(1);
});

test("stops cleanly without reconnecting", () => {
  const sockets: FakeWebSocket[] = [];
  const scheduler = new FakeScheduler();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    scheduler,
    createSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  client.start();
  client.stop();
  sockets[0]?.emitClose();

  expect(scheduler.scheduled.size).toBe(0);
  expect(sockets[0]?.closeCalls).toBe(1);
});

test("never logs the token", () => {
  const socket = new FakeWebSocket("wss://planet.turingguild.com/planet/stream");
  const { logger, lines } = createLogger();
  const client = createKeplerStreamClient({
    registration: createRegistration(),
    createSocket() {
      return socket;
    },
    logger,
  });

  client.start();
  socket.emitOpen();
  socket.emitMessage("{bad-json");
  socket.emitMessage(JSON.stringify({ type: "hello_ack", habitatId: "habitat-999" }));
  socket.emitClose();

  expect(lines.join("\n")).not.toContain("secret-stream-token");
});
