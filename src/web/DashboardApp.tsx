import type { FormEvent } from "react";
import type { LocalHabitatModule } from "../kepler";
import type {
  DashboardModel,
  ModulePowerStatusResponse,
  SolarIrradianceResponse,
  TickResultResponse,
} from "./dashboard-data";

type DashboardAppProps = {
  model: DashboardModel;
  mode: "light" | "dark";
  registrationName: string;
  lastRefreshLabel: string;
  actionErrorMessage?: string | null;
  pendingModuleId?: string | null;
  tickRequestPending?: boolean;
  tickInputValue: string;
  tickInputError?: string | null;
  latestTickResult?: TickResultResponse | null;
  solarIrradiance?: SolarIrradianceResponse | null;
  onRegistrationNameChange?: (value: string) => void;
  onTickInputChange?: (value: string) => void;
  onRegister?: (event: FormEvent<HTMLFormElement>) => void;
  onTickSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh?: () => void;
  onAdvanceTicks?: (count: number) => void;
  onSetModuleStatus?: (moduleId: string, nextStatus: "offline" | "online") => void;
  onToggleTheme?: () => void;
  onOpenUnregister?: () => void;
  onCloseUnregister?: () => void;
  onConfirmUnregister?: () => void;
};

type EnrichedModule = LocalHabitatModule & {
  declaredStatus: string;
  effectiveState: string;
  currentPowerDrawKw: number;
};

export function DashboardApp(props: DashboardAppProps) {
  const {
    model,
    mode,
    registrationName,
    lastRefreshLabel,
    actionErrorMessage,
    pendingModuleId,
    tickRequestPending,
    tickInputValue,
    tickInputError,
    latestTickResult,
    solarIrradiance,
    onRegistrationNameChange,
    onTickInputChange,
    onRegister,
    onTickSubmit,
    onRefresh,
    onAdvanceTicks,
    onSetModuleStatus,
    onToggleTheme,
    onOpenUnregister,
    onCloseUnregister,
    onConfirmUnregister,
  } = props;

  const isRegistered = model.kind === "registered";
  const modules = isRegistered ? enrichModules(model.modules, model.powerStatus) : [];
  const registrationLabel = isRegistered ? "Registered" : "Not registered";
  const statusLabel = isRegistered ? model.status.habitat.status : "offline";
  const totalPower = isRegistered ? `${model.powerStatus.totalCurrentPowerDrawKw.toFixed(2)} kW` : "0.00 kW";
  const currentTick = isRegistered ? model.status.currentTick.toLocaleString() : "0";
  const moduleCount = isRegistered ? String(model.modules.length) : "0";
  const solarConditionLabel = hasSolarIrradiance(solarIrradiance)
    ? `${solarIrradiance.condition} / ${solarIrradiance.irradianceWPerM2} W/m²`
    : "Unavailable";
  const batteryState = latestTickResult?.batteries[0]
    ? `${latestTickResult.batteries[0].currentEnergyKwh.toFixed(2)} / ${latestTickResult.batteries[0].energyStorageKwh.toFixed(2)} kWh`
    : "Unavailable";
  const generatedPower = latestTickResult ? `${latestTickResult.solarCharging.generatedKwh.toFixed(4)} kWh` : "Unavailable";
  const fallbackConsumption = isRegistered
    ? `${model.powerStatus.oneTickEnergyCostKwh.toFixed(4)} kWh/tick`
    : "Unavailable";
  const displayedConsumption = latestTickResult ? `${latestTickResult.totalEnergyUsedKwh.toFixed(4)} kWh` : fallbackConsumption;
  const netPower = latestTickResult
    ? `${(latestTickResult.solarCharging.generatedKwh - latestTickResult.totalEnergyUsedKwh).toFixed(4)} kWh`
    : "Unavailable";
  const shellTelemetry = isRegistered
    ? `${model.status.habitat.habitatSlug} / ${model.status.habitat.catalogVersion}`
    : "REST telemetry unavailable until registration";

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">KEPLER WORLD / FIELD DATABASE</div>
          <nav className="sidebar-nav" aria-label="Primary">
            <div className="sidebar-item is-active">
              <span className="sidebar-icon" aria-hidden="true">◉</span>
              <span>Overview</span>
            </div>
            <div className="sidebar-item">
              <span className="sidebar-icon" aria-hidden="true">◎</span>
              <span>Modules</span>
            </div>
            <div className="sidebar-item">
              <span className="sidebar-icon" aria-hidden="true">◌</span>
              <span>Registration</span>
            </div>
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-meta">
            <span className="sidebar-meta__label">Current tick</span>
            <strong>{currentTick}</strong>
          </div>
          <div className="sidebar-meta">
            <span className="sidebar-meta__label">Last refresh</span>
            <strong>{lastRefreshLabel}</strong>
          </div>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div className="topbar-product">Habitat Control Surface</div>
          <div className="topbar-telemetry" aria-label="Telemetry channel">
            <span className="telemetry-dot" aria-hidden="true" />
            <span className="telemetry-label">{shellTelemetry}</span>
          </div>
          <div className="topbar-actions">
            <span className={`badge badge--${isRegistered ? "online" : "offline"}`}>
              {registrationLabel}
            </span>
            <button type="button" className="theme-toggle" onClick={onToggleTheme}>
              {mode === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </header>

        <section className="hero">
          <p className="eyebrow">Operations summary</p>
          <h1>Habitat Overview</h1>
          <p className="hero-copy">
            Registration state, power draw, and module status from the existing Habitat REST API.
          </p>
        </section>

        <section className={`status-banner ${isRegistered ? "status-banner--ok" : "status-banner--warn"}`}>
          <div className="status-banner__content">
            <span className={`status-bullet status-bullet--${isRegistered ? "online" : "warn"}`} aria-hidden="true" />
            <div>
              <p className="status-banner__label">{isRegistered ? "ACTIVE REGISTRATION" : "REGISTRATION REQUIRED"}</p>
              <p className="status-banner__text">
                {isRegistered
                  ? `${model.registration.displayName} is connected and serving live module state.`
                  : "Register a habitat to load live state from the current Hono API routes."}
              </p>
            </div>
          </div>
          <div className="status-banner__actions">
            <button type="button" className="ghost-button" onClick={onRefresh}>
              Refresh
            </button>
            {isRegistered ? (
              <button type="button" className="danger-button" onClick={onOpenUnregister}>
                Unregister
              </button>
            ) : null}
          </div>
        </section>

        {model.errorMessage || actionErrorMessage ? (
          <section className="error-strip" role="alert">
            <span className="error-strip__label">API error</span>
            <span className="error-strip__message">{actionErrorMessage ?? model.errorMessage}</span>
            <button type="button" className="ghost-button" onClick={onRefresh}>
              Retry
            </button>
          </section>
        ) : null}

        <section className="summary-panel">
          <div className="summary-panel__item">
            <span className="summary-panel__label">Registration</span>
            <strong>{registrationLabel}</strong>
          </div>
          <div className="summary-panel__item">
            <span className="summary-panel__label">Current tick</span>
            <strong>{currentTick}</strong>
          </div>
          <div className="summary-panel__item">
            <span className="summary-panel__label">Modules</span>
            <strong>{moduleCount}</strong>
          </div>
          <div className="summary-panel__item">
            <span className="summary-panel__label">Current draw</span>
            <strong>{totalPower}</strong>
          </div>
        </section>

        <section className="content-grid">
          <article className="panel module-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">System health</p>
                <h2>Module status</h2>
              </div>
              <span className="panel-meta">{isRegistered ? "Live REST-backed state" : "Waiting for registration"}</span>
            </div>

            {isRegistered ? (
              <div className="module-table-wrap">
                <table className="module-table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Blueprint</th>
                      <th>Declared</th>
                      <th>Effective</th>
                      <th>Power draw</th>
                      <th>Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((module) => (
                      <tr key={module.id}>
                        <td>
                          <div className="module-table__primary">
                            <span className="truncate" title={module.displayName}>{module.displayName}</span>
                            <span className="module-table__secondary truncate" title={module.id}>{module.id}</span>
                          </div>
                        </td>
                        <td>
                          <span className="truncate" title={module.blueprintId}>{module.blueprintId}</span>
                        </td>
                        <td>{module.declaredStatus}</td>
                        <td>
                          <span className={`status-pill status-pill--${module.effectiveState.toLowerCase()}`}>
                            {module.effectiveState}
                          </span>
                        </td>
                        <td>{module.currentPowerDrawKw.toFixed(2)} kW</td>
                        <td>
                          <button
                            type="button"
                            className={`table-action ${module.declaredStatus === "offline" ? "table-action--online" : "table-action--offline"}`}
                            disabled={pendingModuleId === module.id || tickRequestPending}
                            onClick={() => onSetModuleStatus?.(
                              module.id,
                              module.declaredStatus === "offline" ? "online" : "offline",
                            )}
                          >
                            {pendingModuleId === module.id
                              ? "Updating..."
                              : module.declaredStatus === "offline"
                                ? "Go online"
                                : "Go offline"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-panel">
                <strong>No module data yet</strong>
                <p>Register first to populate the module status panel from `GET /modules` and `GET /modules/status`.</p>
              </div>
            )}
          </article>

          <div className="side-column">
            <article className="panel power-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Power telemetry</p>
                  <h2>Power panel</h2>
                </div>
                <span className="panel-meta">
                  {hasSolarIrradiance(solarIrradiance) ? solarIrradiance.condition : "Solar unavailable"}
                </span>
              </div>
              <div className="power-grid">
                <div className="power-tile">
                  <span className="power-tile__label">Generation</span>
                  <strong className={latestTickResult ? "power-value power-value--good" : "power-value"}>{generatedPower}</strong>
                </div>
                <div className="power-tile">
                  <span className="power-tile__label">Consumption</span>
                  <strong className="power-value power-value--neutral">{displayedConsumption}</strong>
                </div>
                <div className="power-tile">
                  <span className="power-tile__label">Net power</span>
                  <strong className={`power-value ${getNetPowerClass(latestTickResult)}`}>{netPower}</strong>
                </div>
                <div className="power-tile">
                  <span className="power-tile__label">Battery state</span>
                  <strong className={`power-value ${getBatteryClass(latestTickResult)}`}>{batteryState}</strong>
                </div>
                <div className="power-tile power-tile--wide">
                  <span className="power-tile__label">Solar conditions</span>
                  <strong className="power-value power-value--neutral">
                    {solarIrradiance
                      ? solarConditionLabel
                      : "Unavailable"}
                  </strong>
                </div>
                <div className="power-tile power-tile--wide">
                  <span className="power-tile__label">Charge reason</span>
                  <strong className="power-value power-value--neutral">
                    {latestTickResult?.solarCharging.reason ?? "Advance ticks to populate server-owned generation telemetry."}
                  </strong>
                </div>
              </div>
            </article>

            <article className="panel simulation-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Simulation</p>
                  <h2>Advance simulation</h2>
                </div>
              </div>
              <div className="tick-presets">
                {[1, 60, 600, 3600].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className="tick-button"
                    disabled={!isRegistered || tickRequestPending || pendingModuleId !== null}
                    onClick={() => onAdvanceTicks?.(count)}
                  >
                    {tickRequestPending ? "Running..." : `${count.toLocaleString()} tick${count === 1 ? "" : "s"}`}
                  </button>
                ))}
              </div>
              <form className="tick-form" onSubmit={onTickSubmit}>
                <label className="registration-form__label">
                  <span>Custom tick count</span>
                  <input
                    inputMode="numeric"
                    value={tickInputValue}
                    onChange={(event) => onTickInputChange?.(event.currentTarget.value)}
                    placeholder="120"
                  />
                </label>
                {tickInputError ? <p className="form-help form-help--error">{tickInputError}</p> : null}
                <button type="submit" className="primary-button" disabled={!isRegistered || tickRequestPending || pendingModuleId !== null}>
                  {tickRequestPending ? "Advancing..." : "Run custom ticks"}
                </button>
              </form>
            </article>

            <article className="panel registration-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Registration</p>
                <h2>{isRegistered ? "Habitat details" : "Register habitat"}</h2>
              </div>
            </div>

            {isRegistered ? (
              <dl className="detail-list">
                <div className="detail-row">
                  <dt>Display name</dt>
                  <dd className="truncate" title={model.registration.displayName}>{model.registration.displayName}</dd>
                </div>
                <div className="detail-row">
                  <dt>Habitat ID</dt>
                  <dd className="truncate" title={model.registration.habitatId}>{model.registration.habitatId}</dd>
                </div>
                <div className="detail-row">
                  <dt>Slug</dt>
                  <dd className="truncate" title={model.status.habitat.habitatSlug}>{model.status.habitat.habitatSlug}</dd>
                </div>
                <div className="detail-row">
                  <dt>Catalog</dt>
                  <dd>{model.status.habitat.catalogVersion}</dd>
                </div>
                <div className="detail-row">
                  <dt>Last seen</dt>
                  <dd className="truncate" title={model.status.habitat.lastSeenAt ?? "Unavailable"}>
                    {model.status.habitat.lastSeenAt ?? "Unavailable"}
                  </dd>
                </div>
                <div className="detail-row">
                  <dt>Status</dt>
                  <dd className={`detail-state detail-state--${statusLabel.toLowerCase()}`}>{statusLabel}</dd>
                </div>
              </dl>
            ) : (
              <form className="registration-form" onSubmit={onRegister}>
                <label className="registration-form__label">
                  <span>Habitat display name</span>
                  <input
                    name="displayName"
                    value={registrationName}
                    onChange={(event) => onRegistrationNameChange?.(event.currentTarget.value)}
                    placeholder="Artemis Ridge"
                  />
                </label>
                <p className="form-help">Uses the existing `POST /registration` payload with `displayName` only.</p>
                <button type="submit" className="primary-button" disabled={model.registerPending}>
                  {model.registerPending ? "Registering..." : "Register habitat"}
                </button>
              </form>
            )}
            </article>
          </div>
        </section>

        {model.kind === "registered" && model.confirmUnregister ? (
          <section className="confirm-dialog" role="alertdialog" aria-modal="true">
            <div className="confirm-dialog__content">
              <p className="eyebrow">Confirm habitat unregister</p>
              <h2>Remove this Habitat registration?</h2>
              <p>
                This keeps the existing confirmation step and will call the current unregister route before clearing the dashboard.
              </p>
              <div className="confirm-dialog__actions">
                <button type="button" className="ghost-button" onClick={onCloseUnregister}>
                  Cancel
                </button>
                <button type="button" className="danger-button" onClick={onConfirmUnregister} disabled={model.unregisterPending}>
                  {model.unregisterPending ? "Unregistering..." : "Confirm unregister"}
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function getNetPowerClass(latestTickResult?: TickResultResponse | null) {
  if (!latestTickResult) {
    return "power-value--neutral";
  }
  const net = latestTickResult.solarCharging.generatedKwh - latestTickResult.totalEnergyUsedKwh;
  if (net > 0) return "power-value--good";
  if (net === 0) return "power-value--neutral";
  return "power-value--fault";
}

function getBatteryClass(latestTickResult?: TickResultResponse | null) {
  const battery = latestTickResult?.batteries[0];
  if (!battery) {
    return "power-value--neutral";
  }
  const ratio = battery.energyStorageKwh > 0 ? battery.currentEnergyKwh / battery.energyStorageKwh : 0;
  if (ratio <= 0.15) return "power-value--fault";
  if (ratio <= 0.4) return "power-value--warn";
  return "power-value--good";
}

function hasSolarIrradiance(solarIrradiance?: SolarIrradianceResponse | null): solarIrradiance is SolarIrradianceResponse {
  return typeof solarIrradiance?.condition === "string"
    && typeof solarIrradiance?.irradianceWPerM2 === "number";
}

function enrichModules(
  modules: LocalHabitatModule[],
  powerStatus: ModulePowerStatusResponse,
): EnrichedModule[] {
  return modules.map((module) => {
    const statusRow = powerStatus.rows.find((row) => row.displayName === module.displayName);
    return {
      ...module,
      declaredStatus: statusRow?.declaredStatus ?? "(unknown)",
      effectiveState: statusRow?.effectiveState ?? "offline",
      currentPowerDrawKw: statusRow?.currentPowerDrawKw ?? 0,
    };
  });
}
