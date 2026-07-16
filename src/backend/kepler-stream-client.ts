import type { HabitatRegistrationStream } from "../kepler";

export type KeplerStreamRegistration = {
  habitatId: string;
  apiToken: string;
  streamUrl: string;
  stream: HabitatRegistrationStream;
};

export type LoggerLike = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export type SchedulerLike = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type PlanetTickNotice = {
  previousTick?: number;
  tick: number;
  advancedBy: number;
  issuedAt?: string;
};

export type WebSocketLike = {
  readyState: number;
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
  send(data: string): void;
  close(): void;
};

export type KeplerStreamClient = {
  start(): void;
  stop(): void;
  isAcknowledged(): boolean;
};

type SupportedSubscription = "ticks";

type StreamMessage =
  | {
    type: "hello_ack";
    habitatId: string;
  }
  | {
    type: "planet_tick";
    previousTick?: number;
    tick: number;
    advancedBy: number;
    issuedAt?: string;
  }
  | {
    type: string;
    [key: string]: unknown;
  };

type WebSocketFactory = (url: string) => WebSocketLike;

type KeplerStreamClientOptions = {
  registration: KeplerStreamRegistration;
  createSocket: WebSocketFactory;
  scheduler?: SchedulerLike;
  logger?: LoggerLike;
  reconnectDelayMs?: number;
  onAcknowledged?: (habitatId: string) => void;
  onPlanetTick?: (notice: PlanetTickNotice) => void;
  onDisconnected?: () => void;
};

const SUPPORTED_SUBSCRIPTIONS: SupportedSubscription[] = ["ticks"];
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

export function createKeplerStreamClient(options: KeplerStreamClientOptions): KeplerStreamClient {
  const scheduler = options.scheduler ?? {
    setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
  };
  const logger = options.logger ?? {
    info: (_message: string) => {},
    warn: (_message: string) => {},
    error: (_message: string) => {},
  };
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const subscribe = resolveSubscriptions(options.registration.stream);

  let activeSocket: WebSocketLike | null = null;
  let reconnectTimer: unknown | null = null;
  let stopped = false;
  let acknowledged = false;

  return {
    start() {
      stopped = false;
      if (activeSocket || reconnectTimer !== null) {
        return;
      }
      connect();
    },

    stop() {
      stopped = true;
      acknowledged = false;
      clearReconnectTimer();
      const socket = activeSocket;
      activeSocket = null;
      if (socket) {
        socket.close();
      }
    },

    isAcknowledged() {
      return acknowledged;
    },
  };

  function connect(): void {
    if (stopped || activeSocket) {
      return;
    }

    acknowledged = false;
    const socket = options.createSocket(options.registration.streamUrl);
    activeSocket = socket;

    const handleOpen = () => {
      sendHello(socket, {
        apiToken: options.registration.apiToken,
        subscribe,
      });
    };

    const handleMessage = (event?: unknown) => {
      const message = parseIncomingMessage(event);
      if (!message) {
        logger.warn("Received malformed JSON from the Kepler stream.");
        return;
      }

      if (message.type === "hello_ack") {
        if (message.habitatId !== options.registration.habitatId) {
          logger.warn("Received hello_ack for the wrong habitat.");
          socket.close();
          return;
        }
        acknowledged = true;
        options.onAcknowledged?.(message.habitatId);
        return;
      }

      if (!acknowledged) {
        return;
      }

      if (message.type !== "planet_tick") {
        return;
      }

      if (!isPositiveWholeNumber(message.advancedBy)) {
        logger.warn("Ignoring planet_tick with invalid advancedBy.");
        return;
      }

      if (!isWholeNumber(message.tick) || message.tick < 0) {
        logger.warn("Ignoring planet_tick with invalid tick.");
        return;
      }

      options.onPlanetTick?.({
        previousTick: isWholeNumber(message.previousTick) ? message.previousTick : undefined,
        tick: message.tick,
        advancedBy: message.advancedBy,
        issuedAt: typeof message.issuedAt === "string" && message.issuedAt.trim() ? message.issuedAt : undefined,
      });
    };

    const handleClose = () => {
      if (activeSocket === socket) {
        activeSocket = null;
      }
      acknowledged = false;
      options.onDisconnected?.();
      if (!stopped) {
        scheduleReconnect();
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = scheduler.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) {
      return;
    }
    scheduler.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function sendHello(socket: WebSocketLike, payload: {
    apiToken: string;
    subscribe: SupportedSubscription[];
  }): void {
    socket.send(JSON.stringify({
      type: "hello",
      apiToken: payload.apiToken,
      subscribe: payload.subscribe,
    }));
  }
}

function resolveSubscriptions(stream: HabitatRegistrationStream): SupportedSubscription[] {
  return SUPPORTED_SUBSCRIPTIONS.filter((subscription) => stream.subscriptions.includes(subscription));
}

function parseIncomingMessage(event?: unknown): StreamMessage | null {
  const data = extractMessageData(event);
  if (typeof data !== "string") {
    return null;
  }

  try {
    return JSON.parse(data) as StreamMessage;
  } catch {
    return null;
  }
}

function extractMessageData(event?: unknown): unknown {
  if (!event || typeof event !== "object") {
    return null;
  }

  return (event as { data?: unknown }).data;
}

function isPositiveWholeNumber(value: unknown): value is number {
  return isWholeNumber(value) && value > 0;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
