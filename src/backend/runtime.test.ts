import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { createClockStreamController } from "./clock-stream-controller";
import type { ClockStreamController } from "./clock-stream-controller";
import { shutdownBackendClockRuntime, startBackendClockRuntime } from "./runtime";
import { advanceTicks } from "./habitat-service";
import { readClockState, readCurrentTick, writeClockState, writeRegistration } from "./registration-store";
import type { WebSocketLike } from "./kepler-stream-client";

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

  emitClose(): void {
    for (const listener of this.listeners.get("close") ?? []) {
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

type ClockControllerStartInput = Parameters<ClockStreamController["start"]>[0];

test("startup in manual mode does not connect and keeps manual ticks available", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-manual-"));
  let startCalls = 0;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: () => {
      startCalls += 1;
    },
    stop: async () => {},
  };

  writeClockState(cwd, {
    mode: "manual",
    connectionState: "error",
    latestAbsoluteKeplerTick: 99,
    latestAdvancedBy: 5,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: "2026-07-16T10:00:00.000Z",
    lastErrorMessage: "old error",
  });

  try {
    const result = await startBackendClockRuntime(cwd, fakeController);
    expect(startCalls).toBe(0);
    expect(result.mode).toBe("manual");
    expect(result.connectionState).toBe("disconnected");
    expect(result.manualTicksAllowed).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("startup in kepler mode starts one connection attempt and disables manual ticks immediately", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-kepler-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-runtime-kepler",
    habitatId: "habitat-runtime-kepler",
    displayName: "Runtime Kepler Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });
  writeClockState(cwd, {
    mode: "kepler",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

  let startCalls = 0;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: () => {
      startCalls += 1;
      expect(readClockState(cwd).mode).toBe("kepler");
      expect(readClockState(cwd).connectionState).toBe("connecting");
    },
    stop: async () => {},
  };

  try {
    const result = await startBackendClockRuntime(cwd, fakeController);
    expect(startCalls).toBe(1);
    expect(result.mode).toBe("kepler");
    expect(result.connectionState).toBe("connecting");
    expect(result.manualTicksAllowed).toBe(false);
    await expect(advanceTicks(cwd, 1)).rejects.toThrow("habitat clock listen off");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("missing credentials during kepler-mode startup records a safe error without crashing", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-missing-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-runtime-missing",
    habitatId: "habitat-runtime-missing",
    displayName: "Runtime Missing Habitat",
    apiToken: "",
    streamUrl: null,
    stream: null,
    moduleCount: 0,
  });
  writeClockState(cwd, {
    mode: "kepler",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

  let startCalls = 0;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: () => {
      startCalls += 1;
    },
    stop: async () => {},
  };

  try {
    const result = await startBackendClockRuntime(cwd, fakeController);
    expect(startCalls).toBe(0);
    expect(result.mode).toBe("kepler");
    expect(result.connectionState).toBe("error");
    expect(result.manualTicksAllowed).toBe(false);
    expect(result.lastErrorMessage).toContain("credential");
    expect(result.lastErrorMessage).not.toContain("token");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("restart does not replay missed ticks", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-no-replay-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-runtime-replay",
    habitatId: "habitat-runtime-replay",
    displayName: "Runtime Replay Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 500,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });
  writeClockState(cwd, {
    mode: "kepler",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: 900,
    latestAdvancedBy: 100,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

  let onPlanetTick: ClockControllerStartInput["onPlanetTick"] | undefined;
  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: (input) => {
      onPlanetTick = input.onPlanetTick;
    },
    stop: async () => {},
  };

  try {
    await startBackendClockRuntime(cwd, fakeController);
    expect(readCurrentTick(cwd)).toBe(0);
    expect(readClockState(cwd).latestAbsoluteKeplerTick).toBe(900);
    expect(onPlanetTick).toBeDefined();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("repeated startup initialization does not create duplicate sockets", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-repeat-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-runtime-repeat",
    habitatId: "habitat-runtime-repeat",
    displayName: "Runtime Repeat Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });
  writeClockState(cwd, {
    mode: "kepler",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

  let startCalls = 0;
  let started = false;
  const fakeController: ClockStreamController = {
    isStarted: () => started,
    start: () => {
      startCalls += 1;
      started = true;
    },
    stop: async () => {
      started = false;
    },
  };

  try {
    await startBackendClockRuntime(cwd, fakeController);
    await startBackendClockRuntime(cwd, fakeController);
    expect(startCalls).toBe(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("backend shutdown closes the socket and preserves persisted kepler mode", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-shutdown-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-runtime-shutdown",
    habitatId: "habitat-runtime-shutdown",
    displayName: "Runtime Shutdown Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });
  writeClockState(cwd, {
    mode: "kepler",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

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

  try {
    await startBackendClockRuntime(cwd, controller);
    await shutdownBackendClockRuntime(cwd, controller);

    expect(sockets[0]?.closeCalls).toBe(1);
    expect(scheduler.handles.size).toBe(0);
    expect(readClockState(cwd).mode).toBe("kepler");
    expect(readClockState(cwd).connectionState).toBe("disconnected");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("backend shutdown cancels reconnect timers after an unexpected disconnect", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-shutdown-reconnect-"));

  writeRegistration(cwd, {
    habitatUuid: "uuid-runtime-shutdown-reconnect",
    habitatId: "habitat-runtime-shutdown-reconnect",
    displayName: "Runtime Shutdown Reconnect Habitat",
    apiToken: "stream-secret-token",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 0,
      ticksPerPulse: 1,
      status: "running",
    },
    moduleCount: 0,
  });
  writeClockState(cwd, {
    mode: "kepler",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

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

  try {
    await startBackendClockRuntime(cwd, controller);
    sockets[0]?.emitClose();
    expect(scheduler.handles.size).toBe(1);

    await shutdownBackendClockRuntime(cwd, controller);

    expect(scheduler.handles.size).toBe(0);
    expect(readClockState(cwd).mode).toBe("kepler");
    expect(readClockState(cwd).connectionState).toBe("disconnected");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("backend shutdown preserves persisted manual mode", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-runtime-manual-shutdown-"));

  writeClockState(cwd, {
    mode: "manual",
    connectionState: "disconnected",
    latestAbsoluteKeplerTick: null,
    latestAdvancedBy: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastDisconnectedAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  });

  const fakeController: ClockStreamController = {
    isStarted: () => false,
    start: () => {},
    stop: async () => {},
  };

  try {
    await shutdownBackendClockRuntime(cwd, fakeController);
    expect(readClockState(cwd).mode).toBe("manual");
    expect(readClockState(cwd).connectionState).toBe("disconnected");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
