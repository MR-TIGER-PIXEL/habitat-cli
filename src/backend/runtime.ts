import { readClockState, writeClockState } from "./registration-store";
import {
  getClockStatus,
  initializeClockRuntime,
  shutdownClockRuntime,
} from "./habitat-service";
import { sharedClockStreamController, type ClockStreamController } from "./clock-stream-controller";

export async function startBackendClockRuntime(
  cwd: string,
  controller: ClockStreamController = sharedClockStreamController,
) {
  const clock = readClockState(cwd);
  if (clock.mode === "manual") {
    writeClockState(cwd, {
      ...clock,
      mode: "manual",
      connectionState: "disconnected",
    });
    return getClockStatus(cwd);
  }

  return initializeClockRuntime(cwd, controller);
}

export async function shutdownBackendClockRuntime(
  cwd: string,
  controller: ClockStreamController = sharedClockStreamController,
) {
  await shutdownClockRuntime(cwd, controller);
  return getClockStatus(cwd);
}
