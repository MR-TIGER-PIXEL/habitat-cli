import { readHumans, readModules, readRegistration, writeHumans } from "./registration-store";

export async function listHumans(cwd: string) {
  if (!readRegistration(cwd)) {
    throw new Error("No habitat registration found.");
  }

  return readHumans(cwd);
}

export async function moveHuman(cwd: string, humanId: string, moduleId: string) {
  if (!readRegistration(cwd)) {
    throw new Error("No habitat registration found.");
  }

  const humans = readHumans(cwd);
  const human = humans.find((item) => item.id === humanId);
  if (!human) {
    throw new Error(`Human "${humanId}" not found.`);
  }

  const modules = readModules(cwd);
  const module = modules.find((item) => item.id === moduleId);
  if (!module) {
    throw new Error(`Module "${moduleId}" not found.`);
  }

  const crewCapacity = typeof module.runtimeAttributes.crewCapacity === "number"
    ? module.runtimeAttributes.crewCapacity
    : 0;
  const currentOccupants = humans.filter((item) => item.locationModuleId === moduleId).length;
  const isAlreadyThere = human.locationModuleId === moduleId;
  const wouldOccupancyBe = isAlreadyThere ? currentOccupants : currentOccupants + 1;

  if (wouldOccupancyBe > crewCapacity) {
    throw new Error(`Module "${moduleId}" is already at crewCapacity.`);
  }

  human.locationModuleId = moduleId;
  writeHumans(cwd, humans);
  return human;
}

export function assertModuleNotOccupied(cwd: string, moduleId: string): void {
  if (!readRegistration(cwd)) {
    throw new Error("No habitat registration found.");
  }

  const occupant = readHumans(cwd).find((human) => human.locationModuleId === moduleId);
  if (occupant) {
    throw new Error(`Module "${moduleId}" cannot be deleted while occupied by a human.`);
  }
}
