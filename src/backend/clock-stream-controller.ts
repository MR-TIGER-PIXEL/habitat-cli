import { createKeplerStreamClient, type KeplerStreamClient, type KeplerStreamRegistration, type PlanetTickNotice, type SchedulerLike, type WebSocketLike } from "./kepler-stream-client";

export type ClockStreamController = {
  start(input: {
    registration: KeplerStreamRegistration;
    onAcknowledged: (habitatId: string) => void;
    onUnexpectedDisconnect: () => void;
    onPlanetTick: (notice: PlanetTickNotice) => Promise<void> | void;
  }): void;
  stop(): Promise<void>;
  isStarted(): boolean;
};

type ClockStreamControllerOptions = {
  createSocket?: (url: string) => WebSocketLike;
  scheduler?: SchedulerLike;
  reconnectDelayMs?: number;
};

export function createClockStreamController(options: ClockStreamControllerOptions = {}): ClockStreamController {
  let client: KeplerStreamClient | null = null;
  let started = false;
  let stopping = false;
  const inFlight = new Set<Promise<void>>();

  return {
    start(input) {
      if (started) {
        return;
      }

      const nextClient = createKeplerStreamClient({
        registration: input.registration,
        createSocket: options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
        scheduler: options.scheduler,
        reconnectDelayMs: options.reconnectDelayMs,
        onAcknowledged: input.onAcknowledged,
        onPlanetTick(notice) {
          if (stopping) {
            return;
          }

          const pending = Promise.resolve(input.onPlanetTick(notice));
          inFlight.add(pending);
          void pending.finally(() => {
            inFlight.delete(pending);
          });
        },
        onDisconnected() {
          if (!stopping) {
            input.onUnexpectedDisconnect();
          }
        },
      });

      client = nextClient;
      started = true;

      try {
        nextClient.start();
      } catch (error) {
        client = null;
        started = false;
        throw error;
      }
    },

    async stop() {
      stopping = true;
      const activeClient = client;
      client = null;
      started = false;
      activeClient?.stop();
      await Promise.all([...inFlight]);
      stopping = false;
    },

    isStarted() {
      return started;
    },
  };
}

export const sharedClockStreamController = createClockStreamController();
