export type ClockTickEvent = {
  tick: number;
  advancedBy: number;
  issuedAt: string;
  applied: boolean;
  previousTick?: number | null;
};

type ClockEventListener = (event: ClockTickEvent) => void;

export type ClockEventBroker = {
  publish(event: ClockTickEvent): void;
  subscribe(listener: ClockEventListener): () => void;
  subscriberCount(): number;
};

export function createClockEventBroker(): ClockEventBroker {
  const listeners = new Set<ClockEventListener>();

  return {
    publish(event: ClockTickEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },

    subscribe(listener: ClockEventListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscriberCount() {
      return listeners.size;
    },
  };
}

export const sharedClockEventBroker = createClockEventBroker();
