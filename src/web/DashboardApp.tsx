import type { FormEvent } from "react";
import type {
  ExplorationState,
  HabitatAlert,
  LocalHabitatModule,
  StarterHuman,
} from "../kepler";
import type {
  DashboardModel,
  DashboardScannedTile,
  InventoryEntry,
  ModulePowerStatusResponse,
  SolarIrradianceResponse,
  TickResultResponse,
} from "./dashboard-data";
import {
  getHumanAvatarArtwork,
  getHumanLocationLabel,
  getModuleArtwork,
  type ThemeMode,
} from "./media";

export type DashboardSectionId =
  | "overview"
  | "modules"
  | "crew"
  | "eva"
  | "inventory"
  | "alerts"
  | "registration";

type CollectionResult = {
  resourceType: string;
  collectedKg: number;
  remainingKg: number;
};

type DashboardAppProps = {
  activeSection: DashboardSectionId;
  model: DashboardModel;
  inventory: InventoryEntry[];
  inventoryLoaded: boolean;
  mode: ThemeMode;
  registrationName: string;
  lastRefreshLabel: string;
  actionErrorMessage?: string | null;
  pendingModuleId?: string | null;
  pendingHumanId?: string | null;
  pendingAlertId?: string | null;
  evaActionPending?: boolean;
  tickRequestPending?: boolean;
  collectionPending?: boolean;
  scanPending?: boolean;
  tickInputValue: string;
  collectionQuantityValue?: string;
  selectedDeployHumanId?: string;
  humanDestinationById?: Record<string, string>;
  tickInputError?: string | null;
  collectionInputError?: string | null;
  scanInputError?: string | null;
  latestTickResult?: TickResultResponse | null;
  latestCollectionResult?: CollectionResult | null;
  solarIrradiance?: SolarIrradianceResponse | null;
  selectedModuleId?: string | null;
  selectedHumanId?: string | null;
  selectedTileKey?: string | null;
  scanStrengthValue?: string;
  scanRadiusValue?: string;
  scanMemory?: Record<string, DashboardScannedTile>;
  mapCenter?: { x: number; y: number };
  mapZoom?: number;
  onRegistrationNameChange?: (value: string) => void;
  onTickInputChange?: (value: string) => void;
  onCollectionQuantityChange?: (value: string) => void;
  onDeployHumanSelectionChange?: (value: string) => void;
  onHumanDestinationChange?: (humanId: string, moduleId: string) => void;
  onScanStrengthChange?: (value: string) => void;
  onScanRadiusChange?: (value: string) => void;
  onRegister?: (event: FormEvent<HTMLFormElement>) => void;
  onTickSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onCollectSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onScanSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh?: () => void;
  onAdvanceTicks?: (count: number) => void;
  onSetModuleStatus?: (moduleId: string, nextStatus: "offline" | "online") => void;
  onMoveHuman?: (humanId: string) => void;
  onDeployHuman?: () => void;
  onMoveExplorer?: (delta: { x: number; y: number }) => void;
  onDockExplorer?: () => void;
  onAcknowledgeAlert?: (alertId: string) => void;
  onSelectModule?: (moduleId: string) => void;
  onSelectHuman?: (humanId: string) => void;
  onSelectTile?: (tileKey: string) => void;
  onPanMap?: (delta: { x: number; y: number }) => void;
  onZoomMap?: (delta: number) => void;
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

const SECTION_ITEMS: Array<{ id: DashboardSectionId; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◉" },
  { id: "modules", label: "Modules", icon: "◎" },
  { id: "crew", label: "Crew", icon: "◌" },
  { id: "eva", label: "EVA Operations", icon: "△" },
  { id: "inventory", label: "Inventory", icon: "▣" },
  { id: "alerts", label: "Alerts", icon: "!" },
  { id: "registration", label: "Registration", icon: "◇" },
];

const MAP_RADIUS_BY_ZOOM: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4 };
const MATERIAL_LEGEND = ["ice-regolith", "basalt-composite", "ferrite", "conductive-ore", "rare-catalyst", "silicate-glass", "volatile-compounds", "none", "unknown"] as const;

export function DashboardApp(props: DashboardAppProps) {
  const {
    activeSection,
    model,
    inventory,
    inventoryLoaded,
    mode,
    registrationName,
    lastRefreshLabel,
    actionErrorMessage,
    pendingModuleId,
    pendingHumanId,
    pendingAlertId,
    evaActionPending,
    tickRequestPending,
    collectionPending,
    scanPending,
    tickInputValue,
    collectionQuantityValue = "",
    selectedDeployHumanId = "",
    humanDestinationById = {},
    tickInputError,
    collectionInputError,
    scanInputError,
    latestTickResult,
    latestCollectionResult,
    solarIrradiance,
    selectedModuleId,
    selectedHumanId,
    selectedTileKey,
    scanStrengthValue = "60",
    scanRadiusValue = "1",
    scanMemory = {},
    mapCenter = { x: 0, y: 0 },
    mapZoom = 1,
    onRegistrationNameChange,
    onTickInputChange,
    onCollectionQuantityChange,
    onDeployHumanSelectionChange,
    onHumanDestinationChange,
    onScanStrengthChange,
    onScanRadiusChange,
    onRegister,
    onTickSubmit,
    onCollectSubmit,
    onScanSubmit,
    onRefresh,
    onAdvanceTicks,
    onSetModuleStatus,
    onMoveHuman,
    onDeployHuman,
    onMoveExplorer,
    onDockExplorer,
    onAcknowledgeAlert,
    onSelectModule,
    onSelectHuman,
    onSelectTile,
    onPanMap,
    onZoomMap,
    onToggleTheme,
    onOpenUnregister,
    onCloseUnregister,
    onConfirmUnregister,
  } = props;

  const isRegistered = model.kind === "registered";
  const modules = isRegistered ? enrichModules(model.modules, model.powerStatus) : [];
  const humans = isRegistered ? model.humans : [];
  const alerts = isRegistered ? model.alerts : [];
  const eva = isRegistered ? model.eva : null;
  const selectedModule = selectedModuleId ? modules.find((module) => module.id === selectedModuleId) ?? modules[0] : modules[0];
  const selectedHuman = selectedHumanId ? humans.find((human) => human.id === selectedHumanId) ?? humans[0] : humans[0];
  const selectedTile = selectedTileKey ? scanMemory[selectedTileKey] ?? null : null;
  const unresolvedAlerts = alerts.filter((alert) => alert.status !== "resolved");
  const summaryCards = buildOverviewCards({
    isRegistered,
    model,
    modules,
    humans,
    alerts,
    eva,
    latestTickResult,
    scanMemory,
  });

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">KEPLER WORLD / FIELD DATABASE</div>
          <nav className="sidebar-nav" aria-label="Primary">
            {SECTION_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#/${item.id}`}
                className={`sidebar-item ${activeSection === item.id ? "is-active" : ""}`}
              >
                <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-meta"><span className="sidebar-meta__label">Current tick</span><strong>{isRegistered ? model.status.currentTick.toLocaleString() : "0"}</strong></div>
          <div className="sidebar-meta"><span className="sidebar-meta__label">Section</span><strong>{SECTION_ITEMS.find((item) => item.id === activeSection)?.label}</strong></div>
          <div className="sidebar-meta"><span className="sidebar-meta__label">Last refresh</span><strong>{lastRefreshLabel}</strong></div>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div className="topbar-product">Habitat Control Surface</div>
          <div className="topbar-telemetry" aria-label="Telemetry channel">
            <span className="telemetry-dot" aria-hidden="true" />
            <span className="telemetry-label">
              {isRegistered ? `${model.status.habitat.habitatSlug} / ${model.status.habitat.catalogVersion}` : "REST telemetry unavailable until registration"}
            </span>
          </div>
          <div className="topbar-actions">
            <span className={`badge badge--${isRegistered ? "online" : "offline"}`}>{isRegistered ? "Registered" : "Not registered"}</span>
            <button type="button" className="theme-toggle" onClick={onToggleTheme}>{mode === "dark" ? "Light" : "Dark"}</button>
          </div>
        </header>

        <section className="hero hero--compact">
          <p className="eyebrow">Operations workspace</p>
          <h1>{SECTION_ITEMS.find((item) => item.id === activeSection)?.label ?? "Habitat Overview"}</h1>
          <p className="hero-copy">The sidebar is the primary navigation. Each section keeps its own dedicated workspace while shared state stays live in the background.</p>
        </section>

        {model.errorMessage || actionErrorMessage ? (
          <section className="error-strip" role="alert">
            <span className="error-strip__label">API error</span>
            <span className="error-strip__message">{actionErrorMessage ?? model.errorMessage}</span>
            <button type="button" className="ghost-button" onClick={onRefresh}>Retry</button>
          </section>
        ) : null}

        {activeSection === "overview" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Landing summary</p><h2>Mission overview</h2></div>
                <button type="button" className="ghost-button" onClick={onRefresh}>Refresh</button>
              </div>
              <div className="summary-card-grid">
                {summaryCards.map((card) => (
                  <a key={card.section} href={`#/${card.section}`} className="summary-card">
                    <span className="summary-card__label">{card.label}</span>
                    <strong>{card.value}</strong>
                    <span className="summary-card__meta">{card.meta}</span>
                  </a>
                ))}
              </div>
            </article>
          </section>
        ) : null}

        {activeSection === "modules" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Systems</p><h2>Modules</h2></div>
                <span className="panel-meta">Visual grid with status and occupancy</span>
              </div>
              <div className="module-card-grid">
                {modules.map((module) => {
                  const artwork = getModuleArtwork(module.blueprintId, mode);
                  const occupants = humans.filter((human) => human.locationModuleId === module.id);
                  return (
                    <button key={module.id} type="button" className={`module-card ${selectedModule?.id === module.id ? "is-selected" : ""}`} onClick={() => onSelectModule?.(module.id)}>
                      {artwork ? <img className="module-card__image" src={artwork.src} alt={`${module.displayName} illustration`} /> : <div className="module-card__image module-card__image--placeholder">?</div>}
                      <div className="module-card__body">
                        <strong className="truncate" title={module.displayName}>{module.displayName}</strong>
                        <span className="module-card__meta truncate" title={module.id}>{module.id}</span>
                        <div className="module-card__status"><span className={`status-pill status-pill--${module.effectiveState}`}>{module.effectiveState}</span><span>{module.currentPowerDrawKw.toFixed(2)} kW</span></div>
                        <div className="overlay-badges">
                          {occupants.map((human) => <span key={human.id} className="overlay-badge">{human.displayName}</span>)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {selectedModule ? (
                <div className="detail-panel">
                  <div className="panel-heading panel-heading--tight"><div><p className="eyebrow">Focused detail</p><h3>Module detail panel</h3></div></div>
                  <dl className="detail-list">
                    <div className="detail-row"><dt>Name</dt><dd>{selectedModule.displayName}</dd></div>
                    <div className="detail-row"><dt>Blueprint</dt><dd>{selectedModule.blueprintId}</dd></div>
                    <div className="detail-row"><dt>Module ID</dt><dd>{selectedModule.id}</dd></div>
                    <div className="detail-row"><dt>Declared status</dt><dd>{selectedModule.declaredStatus}</dd></div>
                    <div className="detail-row"><dt>Effective status</dt><dd>{selectedModule.effectiveState}</dd></div>
                    <div className="detail-row"><dt>Current power draw</dt><dd>{selectedModule.currentPowerDrawKw.toFixed(2)} kW</dd></div>
                    <div className="detail-row"><dt>Assigned humans</dt><dd>{getAssignedHumanNames(selectedModule, humans) || "None"}</dd></div>
                  </dl>
                  <button type="button" className={`table-action ${selectedModule.effectiveState === "offline" ? "" : "table-action--offline"}`} disabled={pendingModuleId === selectedModule.id} onClick={() => onSetModuleStatus?.(selectedModule.id, selectedModule.effectiveState === "offline" ? "online" : "offline")}>
                    {pendingModuleId === selectedModule.id ? "Updating..." : selectedModule.effectiveState === "offline" ? "Bring online" : "Go offline"}
                  </button>
                </div>
              ) : null}
            </article>
          </section>
        ) : null}

        {activeSection === "crew" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Roster</p><h2>Crew</h2></div>
                <span className="panel-meta">Movement and EVA status by human</span>
              </div>
              <div className="crew-layout">
                <div className="human-list human-list--compact">
                  {humans.map((human) => (
                    <button key={human.id} type="button" className={`human-card human-card--selectable ${selectedHuman?.id === human.id ? "is-selected" : ""}`} onClick={() => onSelectHuman?.(human.id)}>
                      <img className="human-avatar" src={getHumanAvatarArtwork(human.id).src} alt={`${human.displayName} avatar`} />
                      <div className="human-card__body">
                        <div className="human-card__header"><strong>{human.displayName}</strong><span className="human-card__meta truncate">{human.id}</span></div>
                        <div className="human-card__meta">{eva?.deployedHumanId === human.id ? "On EVA mission" : getHumanLocationLabel(human, modules)}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {selectedHuman ? (
                  <div className="detail-panel">
                    <div className="panel-heading panel-heading--tight"><div><p className="eyebrow">Focused detail</p><h3>Human detail panel</h3></div></div>
                    <dl className="detail-list">
                      <div className="detail-row"><dt>Name</dt><dd>{selectedHuman.displayName}</dd></div>
                      <div className="detail-row"><dt>Human ID</dt><dd>{selectedHuman.id}</dd></div>
                      <div className="detail-row"><dt>Current module</dt><dd>{getHumanLocationLabel(selectedHuman, modules)}</dd></div>
                      <div className="detail-row"><dt>EVA status</dt><dd>{eva?.deployedHumanId === selectedHuman.id ? "Deployed" : "Inside habitat"}</dd></div>
                      <div className="detail-row"><dt>Battery / Oxygen</dt><dd>{eva?.deployedHumanId === selectedHuman.id ? `${eva.batteryPercent ?? 0}% / ${eva.oxygenUnits ?? 0}` : "Unavailable"}</dd></div>
                    </dl>
                    <div className="human-card__controls">
                      <select value={humanDestinationById[selectedHuman.id] ?? selectedHuman.locationModuleId} onChange={(event) => onHumanDestinationChange?.(selectedHuman.id, event.currentTarget.value)}>
                        {modules.map((module) => <option key={module.id} value={module.id}>{module.displayName}</option>)}
                      </select>
                      <button type="button" className="table-action" disabled={pendingHumanId === selectedHuman.id} onClick={() => onMoveHuman?.(selectedHuman.id)}>
                        {pendingHumanId === selectedHuman.id ? "Moving..." : "Move"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          </section>
        ) : null}

        {activeSection === "eva" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Exploration</p><h2>EVA Operations</h2></div><span className="panel-meta">Map, scan, movement, and collection</span></div>
              <div className="eva-operations-grid">
                <div className="eva-map-panel">
                  <div className="eva-map-panel__header">
                    <h3>Coordinate map</h3>
                    <div className="map-toolbar">
                      <button type="button" className="tick-button" onClick={() => onPanMap?.({ x: 0, y: -1 })}>Pan N</button>
                      <button type="button" className="tick-button" onClick={() => onPanMap?.({ x: -1, y: 0 })}>W</button>
                      <button type="button" className="tick-button" onClick={() => onPanMap?.({ x: 1, y: 0 })}>E</button>
                      <button type="button" className="tick-button" onClick={() => onPanMap?.({ x: 0, y: 1 })}>Pan S</button>
                      <button type="button" className="tick-button" onClick={() => onZoomMap?.(-1)}>-</button>
                      <button type="button" className="tick-button" onClick={() => onZoomMap?.(1)}>+</button>
                    </div>
                  </div>
                  <div className="eva-grid-wrap">
                    <div className="eva-grid" style={{ gridTemplateColumns: `repeat(${buildMapTiles(mapCenter, MAP_RADIUS_BY_ZOOM[mapZoom] ?? 2, scanMemory, eva)[0]?.length ?? 1}, minmax(0, 1fr))` }}>
                      {buildMapTiles(mapCenter, MAP_RADIUS_BY_ZOOM[mapZoom] ?? 2, scanMemory, eva).flat().map((tile) => (
                        <button key={tile.key} type="button" className={`eva-tile eva-tile--${tile.kind} material-${tile.materialClass} ${selectedTileKey === tile.key ? "is-selected" : ""}`} onClick={() => onSelectTile?.(tile.key)}>
                          <span className="eva-tile__coords">{tile.x},{tile.y}</span>
                          <span className="eva-tile__label">{tile.kind === "unknown" ? "Unexplored" : tile.kind === "habitat" ? "Habitat" : tile.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="legend"><strong>Material legend</strong><div className="legend__items">{MATERIAL_LEGEND.map((entry) => <span key={entry} className={`legend__item material-${entry}`}><span className="legend__swatch" />{entry}</span>)}</div></div>
                </div>
                <div className="eva-side-stack">
                  <div className="detail-panel">
                    <div className="panel-heading panel-heading--tight"><div><p className="eyebrow">Mission status</p><h3>Explorer telemetry</h3></div></div>
                    <dl className="detail-list">
                      <div className="detail-row"><dt>Deployed human</dt><dd>{getDeployedHumanName(eva, humans)}</dd></div>
                      <div className="detail-row"><dt>Battery / Oxygen</dt><dd>{formatBatteryPercent(eva)} / {formatOxygenUnits(eva)}</dd></div>
                      <div className="detail-row"><dt>Carrying capacity</dt><dd>{eva ? `${getCarriedWeight(eva)} / ${eva.maxCarryingCapacityKg} kg` : "Unavailable"}</dd></div>
                      <div className="detail-row"><dt>Estimated ticks remaining</dt><dd>{getEstimatedTicksRemaining(eva)}</dd></div>
                      <div className="detail-row"><dt>Latest scan</dt><dd>{selectedTile ? `${selectedTile.topCandidate.resourceType ?? "none"} at (${selectedTile.x}, ${selectedTile.y})` : "No scan selected"}</dd></div>
                    </dl>
                    <form className="tick-form" onSubmit={onScanSubmit}>
                      <label className="registration-form__label"><span>Strength</span><input value={scanStrengthValue} onChange={(event) => onScanStrengthChange?.(event.currentTarget.value)} /></label>
                      <label className="registration-form__label"><span>Radius</span><input value={scanRadiusValue} onChange={(event) => onScanRadiusChange?.(event.currentTarget.value)} /></label>
                      {scanInputError ? <p className="validation-message">{scanInputError}</p> : null}
                      <button type="submit" className="primary-button" disabled={scanPending || !eva?.deployedHumanId}>{scanPending ? "Scanning..." : "Scan current location"}</button>
                    </form>
                    <div className="eva-actions">
                      <div className="eva-actions__deploy">
                        <select value={selectedDeployHumanId} onChange={(event) => onDeployHumanSelectionChange?.(event.currentTarget.value)}>
                          <option value="">Select human to deploy</option>
                          {humans.map((human) => <option key={human.id} value={human.id}>{human.displayName}</option>)}
                        </select>
                        <button type="button" className="primary-button" disabled={evaActionPending || !selectedDeployHumanId} onClick={onDeployHuman}>Deploy</button>
                      </div>
                      <div className="eva-actions__move">
                        <button type="button" className="tick-button" disabled={evaActionPending || !eva?.deployedHumanId} onClick={() => onMoveExplorer?.({ x: 0, y: 1 })}>North</button>
                        <div className="eva-actions__move-row">
                          <button type="button" className="tick-button" disabled={evaActionPending || !eva?.deployedHumanId} onClick={() => onMoveExplorer?.({ x: -1, y: 0 })}>West</button>
                          <button type="button" className="tick-button" disabled={evaActionPending || !eva?.deployedHumanId} onClick={() => onMoveExplorer?.({ x: 1, y: 0 })}>East</button>
                        </div>
                        <button type="button" className="tick-button" disabled={evaActionPending || !eva?.deployedHumanId} onClick={() => onMoveExplorer?.({ x: 0, y: -1 })}>South</button>
                      </div>
                      <button type="button" className="ghost-button" disabled={evaActionPending || !eva?.deployedHumanId} onClick={onDockExplorer}>Dock</button>
                    </div>
                    <form className="tick-form" onSubmit={onCollectSubmit}>
                      <label className="registration-form__label"><span>Collection quantity (kg)</span><input inputMode="numeric" value={collectionQuantityValue} onChange={(event) => onCollectionQuantityChange?.(event.currentTarget.value)} /></label>
                      {collectionInputError ? <p className="validation-message">{collectionInputError}</p> : null}
                      <button type="submit" className="primary-button" disabled={collectionPending || !eva?.deployedHumanId}>{collectionPending ? "Collecting..." : "Collect material"}</button>
                    </form>
                    {latestCollectionResult ? <div className="collection-result"><span>Latest collection</span><strong>{latestCollectionResult.collectedKg} kg {latestCollectionResult.resourceType}</strong></div> : null}
                  </div>
                  <div className="detail-panel">
                    <div className="panel-heading panel-heading--tight"><div><p className="eyebrow">Tile details</p><h3>Selected tile information</h3></div></div>
                    {selectedTile ? (
                      <>
                        <dl className="detail-list">
                          <div className="detail-row"><dt>Coordinates</dt><dd>({selectedTile.x}, {selectedTile.y})</dd></div>
                          <div className="detail-row"><dt>Terrain</dt><dd>{selectedTile.terrain}</dd></div>
                          <div className="detail-row"><dt>Top candidate</dt><dd>{selectedTile.topCandidate.resourceType ?? "none"}</dd></div>
                          <div className="detail-row"><dt>Estimated quantity</dt><dd>{formatQuantityEstimate(selectedTile)}</dd></div>
                          <div className="detail-row"><dt>Confidence</dt><dd>{selectedTile.topCandidate.probabilityPct.toFixed(2)}%</dd></div>
                        </dl>
                        <div className="probability-list">{selectedTile.probabilities.map((item) => <div key={`${selectedTile.key}:${item.resourceType ?? "none"}`} className="probability-row"><span>{item.resourceType ?? "none"}</span><span>{item.probabilityPct.toFixed(2)}%</span></div>)}</div>
                      </>
                    ) : <p className="detail-note">Select a scanned tile to inspect it.</p>}
                  </div>
                </div>
              </div>
            </article>
          </section>
        ) : null}

        {activeSection === "inventory" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Resources</p><h2>Inventory</h2></div><span className="panel-meta">Collected and returned resources</span></div>
              {inventoryLoaded ? (
                <div className="inventory-grid">
                  {inventory.length > 0 ? inventory.map((entry) => (
                    <div key={entry.resourceType} className="power-tile">
                      <span className="power-tile__label">{entry.resourceType}</span>
                      <strong>{entry.quantity}</strong>
                    </div>
                  )) : <p className="detail-note">No inventory entries yet.</p>}
                </div>
              ) : <p className="detail-note">Inventory loads when this section becomes active.</p>}
              {latestCollectionResult ? <div className="collection-result"><span>Recent transfer summary</span><strong>{latestCollectionResult.collectedKg} kg {latestCollectionResult.resourceType}</strong></div> : null}
            </article>
          </section>
        ) : null}

        {activeSection === "alerts" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Monitoring</p><h2>Alerts</h2></div><span className="panel-meta">{alerts.length} total</span></div>
              <div className="alert-filter-row">
                <span className="status-pill">Open {alerts.filter((alert) => alert.status === "open").length}</span>
                <span className="status-pill">Acknowledged {alerts.filter((alert) => alert.status === "acknowledged").length}</span>
                <span className="status-pill">Resolved {alerts.filter((alert) => alert.status === "resolved").length}</span>
              </div>
              <div className="alert-list">
                {alerts.length > 0 ? alerts.map((alert) => (
                  <div key={alert.id} className="alert-card">
                    <div className="alert-card__body">
                      <div className="alert-card__header"><span className={`status-pill ${mapAlertTone(alert)}`}>{alert.severity}</span><span className="status-pill">{alert.status}</span></div>
                      <strong>{alert.type}</strong>
                      <span className="human-card__meta">{alert.id}</span>
                    </div>
                    <button type="button" className="table-action" disabled={pendingAlertId === alert.id || alert.status === "resolved"} onClick={() => onAcknowledgeAlert?.(alert.id)}>{pendingAlertId === alert.id ? "Working..." : "Acknowledge"}</button>
                  </div>
                )) : <p className="detail-note">No alerts yet.</p>}
              </div>
            </article>
          </section>
        ) : null}

        {activeSection === "registration" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">Connection</p><h2>Registration</h2></div><button type="button" className="ghost-button" onClick={onRefresh}>Refresh</button></div>
              {isRegistered ? (
                <>
                  <dl className="detail-list">
                    <div className="detail-row"><dt>Habitat name</dt><dd>{model.registration.displayName}</dd></div>
                    <div className="detail-row"><dt>Registration status</dt><dd>Registered</dd></div>
                    <div className="detail-row"><dt>Habitat ID</dt><dd>{model.registration.habitatId}</dd></div>
                    <div className="detail-row"><dt>Backend connection status</dt><dd>{model.status.habitat.status}</dd></div>
                    <div className="detail-row"><dt>Catalog version</dt><dd>{model.status.habitat.catalogVersion}</dd></div>
                  </dl>
                  <button type="button" className="danger-button" onClick={onOpenUnregister}>Unregister</button>
                </>
              ) : (
                <form className="registration-form" onSubmit={onRegister}>
                  <label className="registration-form__label"><span>Habitat display name</span><input value={registrationName} onChange={(event) => onRegistrationNameChange?.(event.currentTarget.value)} /></label>
                  <button type="submit" className="primary-button" disabled={model.registerPending}>Register habitat</button>
                </form>
              )}
            </article>
          </section>
        ) : null}

        {model.confirmUnregister ? (
          <section className="confirm-strip" role="alertdialog" aria-modal="false">
            <div><strong>Confirm habitat unregister</strong><p>This keeps the existing confirmation step before deleting the current Habitat registration.</p></div>
            <div className="confirm-strip__actions"><button type="button" className="ghost-button" onClick={onCloseUnregister}>Cancel</button><button type="button" className="danger-button" onClick={onConfirmUnregister}>Confirm unregister</button></div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function buildOverviewCards(input: {
  isRegistered: boolean;
  model: DashboardModel;
  modules: EnrichedModule[];
  humans: StarterHuman[];
  alerts: HabitatAlert[];
  eva: ExplorationState | null;
  latestTickResult: TickResultResponse | null | undefined;
  scanMemory: Record<string, DashboardScannedTile>;
}) {
  if (!input.isRegistered || input.model.kind !== "registered") {
    return [
      { section: "registration" as DashboardSectionId, label: "Registration", value: "Required", meta: "Open Registration to connect the habitat backend." },
    ];
  }

  const latestScan = Object.values(input.scanMemory).sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))[0];
  return [
    { section: "registration" as DashboardSectionId, label: "Habitat name", value: input.model.registration.displayName, meta: input.model.status.habitat.status },
    { section: "overview" as DashboardSectionId, label: "Current tick", value: input.model.status.currentTick.toLocaleString(), meta: `${input.modules.length} modules online` },
    { section: "modules" as DashboardSectionId, label: "Total power draw", value: `${input.model.powerStatus.totalCurrentPowerDrawKw.toFixed(2)} kW`, meta: "Open Modules for control details" },
    { section: "crew" as DashboardSectionId, label: "Deployed explorers", value: input.eva?.deployedHumanId ? "1" : "0", meta: input.eva?.deployedHumanId ? getEstimatedTicksRemaining(input.eva) + " ticks remaining" : "No active EVA mission" },
    { section: "alerts" as DashboardSectionId, label: "Unresolved alerts", value: String(input.alerts.filter((alert) => alert.status !== "resolved").length), meta: "Open Alerts for acknowledgement controls" },
    { section: "eva" as DashboardSectionId, label: "Latest mission summary", value: latestScan ? `${latestScan.topCandidate.resourceType ?? "none"} @ (${latestScan.x}, ${latestScan.y})` : "No scans yet", meta: latestScan ? latestScan.scannedAt : "Open EVA Operations to scan" },
  ];
}

function enrichModules(modules: LocalHabitatModule[], powerStatus: ModulePowerStatusResponse): EnrichedModule[] {
  const rowsByName = new Map(powerStatus.rows.map((row) => [row.displayName, row]));
  return modules.map((module) => {
    const row = rowsByName.get(module.displayName);
    return {
      ...module,
      declaredStatus: row?.declaredStatus ?? String(module.runtimeAttributes.status ?? "unknown"),
      effectiveState: row?.effectiveState ?? String(module.runtimeAttributes.status ?? "unknown"),
      currentPowerDrawKw: row?.currentPowerDrawKw ?? 0,
    };
  });
}

function getAssignedHumanNames(module: LocalHabitatModule, humans: StarterHuman[]) {
  return humans.filter((human) => human.locationModuleId === module.id).map((human) => human.displayName).join(", ");
}

function getDeployedHumanName(eva: ExplorationState | null, humans: StarterHuman[]) {
  if (!eva?.deployedHumanId) return "No human deployed";
  return humans.find((human) => human.id === eva.deployedHumanId)?.displayName ?? eva.deployedHumanId;
}

function buildMapTiles(center: { x: number; y: number }, radius: number, scanMemory: Record<string, DashboardScannedTile>, eva: ExplorationState | null) {
  const rows: Array<Array<{ key: string; x: number; y: number; kind: "unknown" | "scanned" | "habitat" | "explorer"; label: string; materialClass: string }>> = [];
  for (let y = center.y + radius; y >= center.y - radius; y -= 1) {
    const row: Array<{ key: string; x: number; y: number; kind: "unknown" | "scanned" | "habitat" | "explorer"; label: string; materialClass: string }> = [];
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      const key = `${x},${y}`;
      const scanned = scanMemory[key];
      const isHabitat = x === 0 && y === 0;
      const isExplorer = Boolean(eva?.deployedHumanId && eva.x === x && eva.y === y);
      row.push({
        key,
        x,
        y,
        kind: isExplorer ? "explorer" : isHabitat ? "habitat" : scanned ? "scanned" : "unknown",
        label: scanned?.topCandidate.resourceType ?? "unknown",
        materialClass: (scanned?.topCandidate.resourceType ?? (isHabitat ? "none" : "unknown")).toLowerCase(),
      });
    }
    rows.push(row);
  }
  return rows;
}

function formatBatteryPercent(eva: ExplorationState | null) {
  return eva?.batteryPercent === null || eva?.batteryPercent === undefined ? "Unavailable" : `${eva.batteryPercent}%`;
}

function formatOxygenUnits(eva: ExplorationState | null) {
  return eva?.oxygenUnits === null || eva?.oxygenUnits === undefined ? "Unavailable" : `${eva.oxygenUnits}`;
}

function getCarriedWeight(eva: ExplorationState) {
  return Object.values(eva.carriedResources).reduce((total, quantity) => total + quantity, 0);
}

function getEstimatedTicksRemaining(eva: ExplorationState | null) {
  if (!eva) return "Unavailable";
  const batteryTicks = eva.batteryPercent === null ? null : Math.floor(eva.batteryPercent / eva.batteryDrainPerTickPercent);
  const oxygenTicks = eva.oxygenUnits === null ? null : Math.floor(eva.oxygenUnits / eva.oxygenDrainPerTickUnits);
  const values = [batteryTicks, oxygenTicks].filter((value): value is number => value !== null);
  return values.length > 0 ? String(Math.min(...values)) : "Unavailable";
}

function formatQuantityEstimate(tile: DashboardScannedTile) {
  if (!tile.quantityEstimate) return "Unavailable";
  return `${tile.quantityEstimate.estimatedKg} ${tile.quantityEstimate.unit}`;
}

function mapAlertTone(alert: HabitatAlert) {
  if (alert.severity === "critical") return "status-pill--fault";
  if (alert.severity === "warning") return "status-pill--busy";
  return "";
}
