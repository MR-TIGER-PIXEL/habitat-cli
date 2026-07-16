import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { DashboardApp, type DashboardSectionId } from "./DashboardApp";
import {
  createDashboardApi,
  getErrorMessage,
  loadDashboardData,
  registerHabitat,
  type DashboardModel,
  type DashboardScannedTile,
  type InventoryEntry,
  type SolarIrradianceResponse,
  type TickResultResponse,
  unregisterHabitat,
} from "./dashboard-data";
import "./styles.css";

const api = createDashboardApi();
const DEFAULT_SECTION: DashboardSectionId = "overview";

function App() {
  const [activeSection, setActiveSection] = useState<DashboardSectionId>(readSectionFromHash());
  const [lastRefreshLabel, setLastRefreshLabel] = useState("Pending");
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [pendingModuleId, setPendingModuleId] = useState<string | null>(null);
  const [pendingHumanId, setPendingHumanId] = useState<string | null>(null);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const [tickInputValue, setTickInputValue] = useState("");
  const [collectionQuantityValue, setCollectionQuantityValue] = useState("5");
  const [selectedDeployHumanId, setSelectedDeployHumanId] = useState("");
  const [humanDestinationById, setHumanDestinationById] = useState<Record<string, string>>({});
  const [tickInputError, setTickInputError] = useState<string | null>(null);
  const [collectionInputError, setCollectionInputError] = useState<string | null>(null);
  const [tickRequestPending, setTickRequestPending] = useState(false);
  const [evaActionPending, setEvaActionPending] = useState(false);
  const [collectionPending, setCollectionPending] = useState(false);
  const [latestTickResult, setLatestTickResult] = useState<TickResultResponse | null>(null);
  const [latestCollectionResult, setLatestCollectionResult] = useState<{
    resourceType: string;
    collectedKg: number;
    remainingKg: number;
  } | null>(null);
  const [solarIrradiance, setSolarIrradiance] = useState<SolarIrradianceResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedHumanId, setSelectedHumanId] = useState<string | null>(null);
  const [selectedTileKey, setSelectedTileKey] = useState<string | null>(null);
  const [scanStrengthValue, setScanStrengthValue] = useState("60");
  const [scanRadiusValue, setScanRadiusValue] = useState("1");
  const [scanInputError, setScanInputError] = useState<string | null>(null);
  const [scanPending, setScanPending] = useState(false);
  const [scanMemory, setScanMemory] = useState<Record<string, DashboardScannedTile>>({});
  const [mapCenter, setMapCenter] = useState({ x: 0, y: 0 });
  const [mapZoom, setMapZoom] = useState(1);
  const [model, setModel] = useState<DashboardModel>({
    kind: "unregistered",
    registration: null,
    registerPending: false,
    unregisterPending: false,
    confirmUnregister: false,
    errorMessage: null,
  });
  const [mode, setMode] = useState<"light" | "dark">(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [registrationName, setRegistrationName] = useState("Artemis Ridge");

  useEffect(() => {
    function handleHashChange() {
      setActiveSection(readSectionFromHash());
    }

    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      window.location.hash = "#/overview";
    }

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    void refreshSection(activeSection, { forceBase: true });
  }, []);

  useEffect(() => {
    void refreshSection(activeSection);
  }, [activeSection]);

  useEffect(() => {
    if (model.kind !== "registered") {
      setHumanDestinationById({});
      setSelectedDeployHumanId("");
      setSelectedModuleId(null);
      setSelectedHumanId(null);
      setSelectedTileKey(null);
      setMapCenter({ x: 0, y: 0 });
      setInventory([]);
      setInventoryLoaded(false);
      return;
    }

    setHumanDestinationById((current) => {
      const next = { ...current };
      for (const human of model.humans) {
        if (!next[human.id]) {
          next[human.id] = human.locationModuleId;
        }
      }
      return next;
    });

    setSelectedDeployHumanId((current) => current || model.humans[0]?.id || "");
    setSelectedModuleId((current) => current || model.modules[0]?.id || null);
    setSelectedHumanId((current) => current || model.humans[0]?.id || null);
    setMapCenter((current) => current.x === 0 && current.y === 0
      ? { x: model.eva.x, y: model.eva.y }
      : current);
  }, [model]);

  async function refreshSection(section: DashboardSectionId, options?: { forceBase?: boolean }) {
    setActionErrorMessage(null);

    if (options?.forceBase || model.kind === "unregistered" || model.kind === "error") {
      const nextModel = await loadDashboardData(api);
      setModel(nextModel);
      if (nextModel.kind === "registered") {
        try {
          setSolarIrradiance(await api.getSolarIrradiance());
        } catch {
          setSolarIrradiance(null);
        }
      }
      setLastRefreshLabel(formatRefreshTime());
      if (nextModel.kind !== "registered") {
        return;
      }
    }

    if (model.kind !== "registered") {
      return;
    }

    try {
      switch (section) {
        case "overview": {
          const [status, powerStatus, eva, alerts, solar] = await Promise.all([
            api.getStatus(),
            api.getModulePowerStatus(),
            api.getEvaStatus(),
            api.listAlerts(),
            api.getSolarIrradiance().catch(() => null),
          ]);
          setModel((current) => current.kind === "registered" ? { ...current, status, powerStatus, eva, alerts } : current);
          setSolarIrradiance(solar);
          break;
        }
        case "modules": {
          const [modules, powerStatus, humans] = await Promise.all([
            api.listModules(),
            api.getModulePowerStatus(),
            api.listHumans(),
          ]);
          setModel((current) => current.kind === "registered" ? { ...current, modules, powerStatus, humans } : current);
          break;
        }
        case "crew": {
          const [humans, modules, eva] = await Promise.all([
            api.listHumans(),
            api.listModules(),
            api.getEvaStatus(),
          ]);
          setModel((current) => current.kind === "registered" ? { ...current, humans, modules, eva } : current);
          break;
        }
        case "eva": {
          const [eva, alerts] = await Promise.all([
            api.getEvaStatus(),
            api.listAlerts(),
          ]);
          setModel((current) => current.kind === "registered" ? { ...current, eva, alerts } : current);
          break;
        }
        case "inventory": {
          const items = await api.listInventory();
          setInventory(items);
          setInventoryLoaded(true);
          break;
        }
        case "alerts": {
          const alerts = await api.listAlerts();
          setModel((current) => current.kind === "registered" ? { ...current, alerts } : current);
          break;
        }
        case "registration": {
          const status = await api.getStatus();
          setModel((current) => current.kind === "registered" ? { ...current, status } : current);
          break;
        }
      }
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setLastRefreshLabel(formatRefreshTime());
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionErrorMessage(null);
    setModel((current) => ({ ...current, registerPending: true, errorMessage: null }));

    try {
      const nextModel = await registerHabitat(api, registrationName.trim());
      setModel(nextModel);
      await refreshSection(activeSection, { forceBase: true });
    } catch (error) {
      setModel((current) => ({
        ...current,
        registerPending: false,
        errorMessage: getErrorMessage(error),
      }));
    }
  }

  async function handleConfirmUnregister() {
    setActionErrorMessage(null);
    setModel((current) => ({ ...current, unregisterPending: true, errorMessage: null }));

    try {
      const nextModel = await unregisterHabitat(api);
      setModel(nextModel);
      setInventory([]);
      setInventoryLoaded(false);
    } catch (error) {
      setModel((current) => ({
        ...current,
        unregisterPending: false,
        confirmUnregister: false,
        errorMessage: getErrorMessage(error),
      }));
    }
  }

  async function handleModuleStatusChange(moduleId: string, nextStatus: "offline" | "online") {
    if (pendingModuleId || tickRequestPending || evaActionPending || collectionPending || scanPending) {
      return;
    }
    setActionErrorMessage(null);
    setPendingModuleId(moduleId);
    try {
      await api.setModuleStatus(moduleId, nextStatus);
      await refreshSection("modules");
      if (activeSection === "overview") {
        await refreshSection("overview");
      }
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setPendingModuleId(null);
    }
  }

  async function handleAdvanceTicks(count: number) {
    if (tickRequestPending || pendingModuleId) {
      return;
    }
    setActionErrorMessage(null);
    setTickInputError(null);
    setTickRequestPending(true);
    try {
      const tickResult = await api.advanceTicks(count);
      setLatestTickResult(tickResult);
      await Promise.all([
        refreshSection(activeSection),
        refreshSection("overview"),
      ]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setTickRequestPending(false);
    }
  }

  async function handleCustomTickSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(tickInputValue);
    if (tickInputValue.trim() === "" || !Number.isInteger(parsed) || parsed <= 0) {
      setTickInputError("Use a positive whole number.");
      return;
    }
    await handleAdvanceTicks(parsed);
  }

  async function handleMoveHuman(humanId: string) {
    if (model.kind !== "registered") return;
    const moduleId = humanDestinationById[humanId];
    if (!moduleId) return;
    setActionErrorMessage(null);
    setPendingHumanId(humanId);
    try {
      await api.moveHuman(humanId, moduleId);
      await refreshSection("crew");
      await refreshSection("modules");
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setPendingHumanId(null);
    }
  }

  async function handleDeployHuman() {
    if (selectedDeployHumanId.trim() === "") return;
    setActionErrorMessage(null);
    setEvaActionPending(true);
    try {
      await api.deployHuman(selectedDeployHumanId);
      await Promise.all([refreshSection("eva"), refreshSection("crew"), refreshSection("overview")]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setEvaActionPending(false);
    }
  }

  async function handleMoveExplorer(delta: { x: number; y: number }) {
    if (model.kind !== "registered") return;
    setActionErrorMessage(null);
    setEvaActionPending(true);
    try {
      await api.moveExplorer(model.eva.x + delta.x, model.eva.y + delta.y);
      await Promise.all([refreshSection("eva"), refreshSection("overview")]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setEvaActionPending(false);
    }
  }

  async function handleDockExplorer() {
    setActionErrorMessage(null);
    setEvaActionPending(true);
    try {
      await api.dockExplorer();
      await Promise.all([refreshSection("eva"), refreshSection("crew"), refreshSection("overview")]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setEvaActionPending(false);
    }
  }

  async function handleCollectSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(collectionQuantityValue);
    if (collectionQuantityValue.trim() === "" || !Number.isInteger(parsed) || parsed <= 0) {
      setCollectionInputError("Use a positive whole number of kilograms.");
      return;
    }
    setActionErrorMessage(null);
    setCollectionInputError(null);
    setCollectionPending(true);
    try {
      const result = await api.collectMaterial(parsed);
      setLatestCollectionResult(result);
      if (model.kind === "registered") {
        setScanMemory((current) => {
          const key = createTileKey(model.eva.x, model.eva.y);
          const existing = current[key];
          if (!existing) return current;
          return { ...current, [key]: { ...existing, collectedKg: (existing.collectedKg ?? 0) + result.collectedKg } };
        });
      }
      await Promise.all([refreshSection("eva"), refreshSection("inventory"), refreshSection("alerts")]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setCollectionPending(false);
    }
  }

  async function handleAcknowledgeAlert(alertId: string) {
    setActionErrorMessage(null);
    setPendingAlertId(alertId);
    try {
      await api.acknowledgeAlert(alertId);
      await Promise.all([refreshSection("alerts"), refreshSection("overview"), activeSection === "eva" ? refreshSection("eva") : Promise.resolve()]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAlertId(null);
    }
  }

  async function handleScanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const strength = Number(scanStrengthValue);
    const radius = Number(scanRadiusValue);
    if (!Number.isInteger(strength) || strength < 0 || strength > 100) {
      setScanInputError("Use an integer scan strength from 0 through 100.");
      return;
    }
    if (!Number.isInteger(radius) || radius < 0 || radius > 5) {
      setScanInputError("Use an integer scan radius from 0 through 5.");
      return;
    }
    setActionErrorMessage(null);
    setScanInputError(null);
    setScanPending(true);
    try {
      const result = await api.scanWorld({ sensorStrength: strength, radiusTiles: radius });
      const scannedAt = new Date().toISOString();
      setScanMemory((current) => {
        const next = { ...current };
        for (const tile of result.scan.tiles) {
          const key = createTileKey(tile.x, tile.y);
          next[key] = { ...tile, key, scannedAt, collectedKg: current[key]?.collectedKg };
        }
        return next;
      });
      const originKey = createTileKey(result.scan.origin.x, result.scan.origin.y);
      setSelectedTileKey(originKey);
      setMapCenter({ x: result.scan.origin.x, y: result.scan.origin.y });
      await Promise.all([refreshSection("eva"), refreshSection("alerts"), refreshSection("overview")]);
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setScanPending(false);
    }
  }

  function toggleTheme() {
    const nextMode = mode === "dark" ? "light" : "dark";
    setMode(nextMode);
    document.documentElement.dataset.theme = nextMode;
    window.localStorage.setItem("habitat-dashboard-theme", nextMode);
  }

  return (
    <DashboardApp
      activeSection={activeSection}
      model={model}
      inventory={inventory}
      inventoryLoaded={inventoryLoaded}
      mode={mode}
      registrationName={registrationName}
      lastRefreshLabel={lastRefreshLabel}
      actionErrorMessage={actionErrorMessage}
      pendingModuleId={pendingModuleId}
      pendingHumanId={pendingHumanId}
      pendingAlertId={pendingAlertId}
      evaActionPending={evaActionPending}
      tickRequestPending={tickRequestPending}
      collectionPending={collectionPending}
      scanPending={scanPending}
      tickInputValue={tickInputValue}
      collectionQuantityValue={collectionQuantityValue}
      selectedDeployHumanId={selectedDeployHumanId}
      humanDestinationById={humanDestinationById}
      tickInputError={tickInputError}
      collectionInputError={collectionInputError}
      scanInputError={scanInputError}
      latestTickResult={latestTickResult}
      latestCollectionResult={latestCollectionResult}
      solarIrradiance={solarIrradiance}
      selectedModuleId={selectedModuleId}
      selectedHumanId={selectedHumanId}
      selectedTileKey={selectedTileKey}
      scanStrengthValue={scanStrengthValue}
      scanRadiusValue={scanRadiusValue}
      scanMemory={scanMemory}
      mapCenter={mapCenter}
      mapZoom={mapZoom}
      onRegistrationNameChange={setRegistrationName}
      onTickInputChange={(value) => {
        setTickInputValue(value);
        if (tickInputError) setTickInputError(null);
      }}
      onCollectionQuantityChange={(value) => {
        setCollectionQuantityValue(value);
        if (collectionInputError) setCollectionInputError(null);
      }}
      onDeployHumanSelectionChange={setSelectedDeployHumanId}
      onHumanDestinationChange={(humanId, moduleId) => setHumanDestinationById((current) => ({ ...current, [humanId]: moduleId }))}
      onScanStrengthChange={(value) => {
        setScanStrengthValue(value);
        if (scanInputError) setScanInputError(null);
      }}
      onScanRadiusChange={(value) => {
        setScanRadiusValue(value);
        if (scanInputError) setScanInputError(null);
      }}
      onRegister={handleRegister}
      onTickSubmit={handleCustomTickSubmit}
      onCollectSubmit={handleCollectSubmit}
      onScanSubmit={handleScanSubmit}
      onRefresh={() => { void refreshSection(activeSection, { forceBase: activeSection === "overview" }); }}
      onAdvanceTicks={(count) => { void handleAdvanceTicks(count); }}
      onSetModuleStatus={(moduleId, nextStatus) => { void handleModuleStatusChange(moduleId, nextStatus); }}
      onMoveHuman={(humanId) => { void handleMoveHuman(humanId); }}
      onDeployHuman={() => { void handleDeployHuman(); }}
      onMoveExplorer={(delta) => { void handleMoveExplorer(delta); }}
      onDockExplorer={() => { void handleDockExplorer(); }}
      onAcknowledgeAlert={(alertId) => { void handleAcknowledgeAlert(alertId); }}
      onSelectModule={setSelectedModuleId}
      onSelectHuman={setSelectedHumanId}
      onSelectTile={setSelectedTileKey}
      onPanMap={(delta) => setMapCenter((current) => ({ x: current.x + delta.x, y: current.y + delta.y }))}
      onZoomMap={(delta) => setMapZoom((current) => Math.max(1, Math.min(4, current + delta)))}
      onToggleTheme={toggleTheme}
      onOpenUnregister={() => setModel((current) => ({ ...current, confirmUnregister: true }))}
      onCloseUnregister={() => setModel((current) => ({ ...current, confirmUnregister: false, unregisterPending: false }))}
      onConfirmUnregister={() => { void handleConfirmUnregister(); }}
    />
  );
}

function readSectionFromHash(): DashboardSectionId {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (raw === "modules" || raw === "crew" || raw === "eva" || raw === "inventory" || raw === "alerts" || raw === "registration") {
    return raw;
  }
  return DEFAULT_SECTION;
}

function createTileKey(x: number, y: number) {
  return `${x},${y}`;
}

function formatRefreshTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for the Habitat dashboard.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
