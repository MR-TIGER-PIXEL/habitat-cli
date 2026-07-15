import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { DashboardApp } from "./DashboardApp";
import {
  createDashboardApi,
  getErrorMessage,
  loadDashboardData,
  registerHabitat,
  type SolarIrradianceResponse,
  type TickResultResponse,
  unregisterHabitat,
  type DashboardModel,
} from "./dashboard-data";
import "./styles.css";

const api = createDashboardApi();

function App() {
  const [lastRefreshLabel, setLastRefreshLabel] = useState("Pending");
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [pendingModuleId, setPendingModuleId] = useState<string | null>(null);
  const [tickInputValue, setTickInputValue] = useState("");
  const [tickInputError, setTickInputError] = useState<string | null>(null);
  const [tickRequestPending, setTickRequestPending] = useState(false);
  const [latestTickResult, setLatestTickResult] = useState<TickResultResponse | null>(null);
  const [solarIrradiance, setSolarIrradiance] = useState<SolarIrradianceResponse | null>(null);
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
    void refresh();
  }, []);

  async function refresh() {
    setActionErrorMessage(null);
    setModel((current) => ({ ...current, errorMessage: null }));
    const nextModel = await loadDashboardData(api);
    setModel(nextModel);
    if (nextModel.kind === "registered") {
      try {
        setSolarIrradiance(await api.getSolarIrradiance());
      } catch {
        setSolarIrradiance(null);
      }
    } else {
      setSolarIrradiance(null);
      setLatestTickResult(null);
    }
    setLastRefreshLabel(formatRefreshTime());
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionErrorMessage(null);
    setModel((current) => ({ ...current, registerPending: true, errorMessage: null }));

    try {
      const nextModel = await registerHabitat(api, registrationName.trim());
      setModel(nextModel);
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
    if (pendingModuleId || tickRequestPending) {
      return;
    }

    setActionErrorMessage(null);
    setPendingModuleId(moduleId);

    try {
      await api.setModuleStatus(moduleId, nextStatus);
      await refresh();
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
      await refresh();
    } catch (error) {
      setActionErrorMessage(getErrorMessage(error));
    } finally {
      setTickRequestPending(false);
    }
  }

  async function handleCustomTickSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(tickInputValue);

    if (
      tickInputValue.trim() === ""
      || !Number.isInteger(parsed)
      || parsed <= 0
    ) {
      setTickInputError("Use a positive whole number.");
      return;
    }

    await handleAdvanceTicks(parsed);
  }

  function toggleTheme() {
    const nextMode = mode === "dark" ? "light" : "dark";
    setMode(nextMode);
    document.documentElement.dataset.theme = nextMode;
    window.localStorage.setItem("habitat-dashboard-theme", nextMode);
  }

  return (
    <DashboardApp
      model={model}
      mode={mode}
      registrationName={registrationName}
      lastRefreshLabel={lastRefreshLabel}
      actionErrorMessage={actionErrorMessage}
      pendingModuleId={pendingModuleId}
      tickRequestPending={tickRequestPending}
      tickInputValue={tickInputValue}
      tickInputError={tickInputError}
      latestTickResult={latestTickResult}
      solarIrradiance={solarIrradiance}
      onRegistrationNameChange={setRegistrationName}
      onTickInputChange={(value) => {
        setTickInputValue(value);
        if (tickInputError) {
          setTickInputError(null);
        }
      }}
      onRegister={handleRegister}
      onTickSubmit={handleCustomTickSubmit}
      onRefresh={() => {
        void refresh();
      }}
      onAdvanceTicks={(count) => {
        void handleAdvanceTicks(count);
      }}
      onSetModuleStatus={(moduleId, nextStatus) => {
        void handleModuleStatusChange(moduleId, nextStatus);
      }}
      onToggleTheme={toggleTheme}
      onOpenUnregister={() => setModel((current) => ({ ...current, confirmUnregister: true }))}
      onCloseUnregister={() => setModel((current) => ({ ...current, confirmUnregister: false, unregisterPending: false }))}
      onConfirmUnregister={() => {
        void handleConfirmUnregister();
      }}
    />
  );
}

function formatRefreshTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
