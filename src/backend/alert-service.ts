import type { AlertContract, HabitatAlert, HabitatAlertSeverity, HabitatAlertStatus } from "../kepler";
import { readAlertContract, readAlerts, writeAlerts } from "./registration-store";

type AlertObservation = {
  id: string;
  type: string;
  severity: HabitatAlertSeverity;
  source: string;
  now?: string;
  subjectHumanId?: string;
  subjectModuleId?: string;
};

export function listAlerts(cwd: string): HabitatAlert[] {
  return readAlerts(cwd);
}

export function acknowledgeAlert(cwd: string, alertId: string, now = new Date().toISOString()): HabitatAlert {
  return updateAlert(cwd, alertId, (alert) => ({
    ...alert,
    status: "acknowledged",
    lastObservedAt: now,
  }));
}

export function observeExplorerDeployedAlert(
  cwd: string,
  input: { humanId: string; now?: string },
): Promise<HabitatAlert | null> {
  return observeAlert(cwd, {
    id: `alert:eva-deployed:${input.humanId}`,
    type: "eva.deployed-outside-habitat",
    severity: "warning",
    source: "local.eva",
    subjectHumanId: input.humanId,
    now: input.now,
  });
}

export function resolveExplorerDeployedAlert(
  cwd: string,
  input: { humanId: string; now?: string },
): HabitatAlert | null {
  return resolveAlert(cwd, `alert:eva-deployed:${input.humanId}`, input.now);
}

export function observeCarryingCapacityAlert(
  cwd: string,
  input: { humanId: string; now?: string },
): Promise<HabitatAlert | null> {
  return observeAlert(cwd, {
    id: `alert:eva-capacity:${input.humanId}`,
    type: "eva.max-carrying-capacity",
    severity: "warning",
    source: "local.collect",
    subjectHumanId: input.humanId,
    now: input.now,
  });
}

export function resolveCarryingCapacityAlert(
  cwd: string,
  input: { humanId: string; now?: string },
): HabitatAlert | null {
  return resolveAlert(cwd, `alert:eva-capacity:${input.humanId}`, input.now);
}

export function observeCollectionFailureAlert(
  cwd: string,
  input: { humanId: string; message: string; now?: string },
): Promise<HabitatAlert | null> {
  void input.message;
  return observeAlert(cwd, {
    id: `alert:collection-failed:${input.humanId}`,
    type: "eva.collection-failed",
    severity: "warning",
    source: "local.collect",
    subjectHumanId: input.humanId,
    now: input.now,
  });
}

export function resolveCollectionFailureAlert(
  cwd: string,
  input: { humanId: string; now?: string },
): HabitatAlert | null {
  return resolveAlert(cwd, `alert:collection-failed:${input.humanId}`, input.now);
}

async function observeAlert(cwd: string, observation: AlertObservation): Promise<HabitatAlert | null> {
  const contract = await ensureAlertContract(cwd);
  if (!contract) {
    return null;
  }
  const alerts = readAlerts(cwd);
  const now = observation.now ?? new Date().toISOString();
  const existing = alerts.find((alert) => alert.id === observation.id);

  const nextAlert: HabitatAlert = existing
    ? {
      ...existing,
      contract,
      severity: observation.severity,
      status: existing.status === "resolved" ? "open" : existing.status,
      source: observation.source,
      lastObservedAt: now,
      occurrenceCount: existing.occurrenceCount + 1,
      subjectHumanId: observation.subjectHumanId,
      subjectModuleId: observation.subjectModuleId,
    }
    : {
      id: observation.id,
      type: observation.type,
      contract,
      severity: observation.severity,
      status: "open",
      source: observation.source,
      createdAt: now,
      lastObservedAt: now,
      occurrenceCount: 1,
      subjectHumanId: observation.subjectHumanId,
      subjectModuleId: observation.subjectModuleId,
    };

  persistAlert(cwd, alerts, nextAlert);
  return nextAlert;
}

function resolveAlert(cwd: string, alertId: string, now = new Date().toISOString()): HabitatAlert | null {
  const alerts = readAlerts(cwd);
  const existing = alerts.find((alert) => alert.id === alertId);
  if (!existing) {
    return null;
  }

  const nextAlert: HabitatAlert = {
    ...existing,
    status: "resolved",
    lastObservedAt: now,
  };
  persistAlert(cwd, alerts, nextAlert);
  return nextAlert;
}

function updateAlert(
  cwd: string,
  alertId: string,
  mutator: (alert: HabitatAlert) => HabitatAlert,
): HabitatAlert {
  const alerts = readAlerts(cwd);
  const existing = alerts.find((alert) => alert.id === alertId);
  if (!existing) {
    throw new Error(`Alert "${alertId}" not found.`);
  }

  const nextAlert = mutator(existing);
  persistAlert(cwd, alerts, nextAlert);
  return nextAlert;
}

function persistAlert(cwd: string, alerts: HabitatAlert[], nextAlert: HabitatAlert): void {
  const nextAlerts = alerts.filter((alert) => alert.id !== nextAlert.id);
  nextAlerts.push(nextAlert);
  writeAlerts(cwd, nextAlerts);
}

export function isAlertStatus(value: string): value is HabitatAlertStatus {
  return value === "open" || value === "acknowledged" || value === "resolved";
}

async function ensureAlertContract(cwd: string): Promise<AlertContract | null> {
  return readAlertContract(cwd);
}
