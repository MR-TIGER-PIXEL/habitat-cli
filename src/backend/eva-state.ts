import {
  DEFAULT_EVA_BATTERY_DRAIN_PER_TICK_PERCENT,
  DEFAULT_EVA_LOW_RESOURCE_THRESHOLD_PERCENT,
  DEFAULT_EVA_MAX_BATTERY_PERCENT,
  DEFAULT_EVA_MAX_CARRYING_CAPACITY_KG,
  DEFAULT_EVA_MAX_OXYGEN_UNITS,
  DEFAULT_EVA_OXYGEN_DRAIN_PER_TICK_UNITS,
  type ExplorationState,
} from "../kepler";

export function createDefaultEvaState(): ExplorationState {
  return {
    deployedHumanId: null,
    x: 0,
    y: 0,
    carriedResources: {},
    maxCarryingCapacityKg: DEFAULT_EVA_MAX_CARRYING_CAPACITY_KG,
    batteryPercent: null,
    maxBatteryPercent: DEFAULT_EVA_MAX_BATTERY_PERCENT,
    batteryDrainPerTickPercent: DEFAULT_EVA_BATTERY_DRAIN_PER_TICK_PERCENT,
    oxygenUnits: null,
    maxOxygenUnits: DEFAULT_EVA_MAX_OXYGEN_UNITS,
    oxygenDrainPerTickUnits: DEFAULT_EVA_OXYGEN_DRAIN_PER_TICK_UNITS,
  };
}

export function createDeployedEvaState(state: ExplorationState, humanId: string): ExplorationState {
  return {
    ...state,
    deployedHumanId: humanId,
    x: 0,
    y: 0,
    batteryPercent: state.maxBatteryPercent,
    oxygenUnits: state.maxOxygenUnits,
  };
}

export function clearDeployedEvaState(state: ExplorationState): ExplorationState {
  return {
    ...state,
    deployedHumanId: null,
    x: 0,
    y: 0,
    carriedResources: {},
    batteryPercent: null,
    oxygenUnits: null,
  };
}

export function drainEvaResourcesForTicks(state: ExplorationState, count: number): ExplorationState {
  if (!state.deployedHumanId) {
    return state;
  }

  let nextState = { ...state };
  for (let tick = 0; tick < count; tick += 1) {
    nextState = {
      ...nextState,
      batteryPercent: Math.max(0, (nextState.batteryPercent ?? nextState.maxBatteryPercent) - nextState.batteryDrainPerTickPercent),
      oxygenUnits: Math.max(0, (nextState.oxygenUnits ?? nextState.maxOxygenUnits) - nextState.oxygenDrainPerTickUnits),
    };
  }
  return nextState;
}

export function getEvaExhaustionMessage(state: ExplorationState): string | null {
  const batteryExhausted = state.deployedHumanId !== null && state.batteryPercent !== null && state.batteryPercent <= 0;
  const oxygenExhausted = state.deployedHumanId !== null && state.oxygenUnits !== null && state.oxygenUnits <= 0;

  if (batteryExhausted && oxygenExhausted) {
    return "Explorer battery and oxygen are exhausted. The explorer did not return in time.";
  }
  if (batteryExhausted) {
    return "Explorer battery is exhausted. The explorer did not return in time.";
  }
  if (oxygenExhausted) {
    return "Explorer oxygen is exhausted. The explorer did not return in time.";
  }
  return null;
}

export function assertExplorerOperational(state: ExplorationState): void {
  const message = getEvaExhaustionMessage(state);
  if (message) {
    throw new Error(message);
  }
}

export function isBatteryLow(state: ExplorationState): boolean {
  return state.deployedHumanId !== null
    && state.batteryPercent !== null
    && state.batteryPercent > 0
    && state.batteryPercent <= (state.maxBatteryPercent * DEFAULT_EVA_LOW_RESOURCE_THRESHOLD_PERCENT) / 100;
}

export function isOxygenLow(state: ExplorationState): boolean {
  return state.deployedHumanId !== null
    && state.oxygenUnits !== null
    && state.oxygenUnits > 0
    && state.oxygenUnits <= (state.maxOxygenUnits * DEFAULT_EVA_LOW_RESOURCE_THRESHOLD_PERCENT) / 100;
}

export function estimateEvaTicksRemaining(state: ExplorationState): number | null {
  if (state.deployedHumanId === null || state.batteryPercent === null || state.oxygenUnits === null) {
    return null;
  }

  const batteryTicks = Math.ceil(state.batteryPercent / state.batteryDrainPerTickPercent);
  const oxygenTicks = Math.ceil(state.oxygenUnits / state.oxygenDrainPerTickUnits);
  return Math.min(batteryTicks, oxygenTicks);
}
