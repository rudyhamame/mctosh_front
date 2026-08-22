import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { apiUrl } from "../config/api";
import {
  getPyMuPDFActivitySnapshot,
  subscribeToPyMuPDFActivity,
} from "../PDF/pymupdfActivity";
import { useSourceBackgroundTasks } from "../Sources/sourceBackgroundTasks";
import { AI_PROVIDERS, useAIProvider } from "../hooks/useAIProvider";
import { getGlyphCharActivitySnapshot, subscribeToGlyphCharActivity } from "../PDF/glyphChar/glyphCharActivity";

const ServiceStatusFooter = ({ containerId = "app_footer_services", className = "" }) => {
  const [services, setServices] = useState([]);
  const [reachable, setReachable] = useState(true);
  const { provider: configuredProvider } = useAIProvider();
  const [activeProvider, setActiveProvider] = useState(() => localStorage.getItem("mctosh_ai_provider") || configuredProvider);
  const [providerModels, setProviderModels] = useState(() => Object.fromEntries(AI_PROVIDERS.map((item) => [item.id, item.sub])));
  const pymupdfRequestCount = useSyncExternalStore(
    subscribeToPyMuPDFActivity,
    getPyMuPDFActivitySnapshot,
    getPyMuPDFActivitySnapshot,
  );
  const glyphCharRequestCount = useSyncExternalStore(
    subscribeToGlyphCharActivity,
    getGlyphCharActivitySnapshot,
    getGlyphCharActivitySnapshot,
  );
  const sourceBackgroundTasks = useSourceBackgroundTasks();
  const backendBackgroundBusy = sourceBackgroundTasks.some((task) => task.status === "running");

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(apiUrl("/api/services/status"), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Service monitor unavailable.");
      const data = await response.json();
      const services = Array.isArray(data.services) ? data.services : [];
      const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
      setServices([...services, ...capabilities]);
      setReachable(true);
    } catch {
      setReachable(false);
      setServices((current) => current.map((service) => ({ ...service, online: false, status: "broken" })));
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, 5000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    const syncProvider = () => setActiveProvider(localStorage.getItem("mctosh_ai_provider") || configuredProvider);
    syncProvider();
    const interval = window.setInterval(syncProvider, 1000);
    const loadProviderModels = async () => {
      try {
        const response = await fetch(apiUrl("/api/settings/ai-status"), { cache: "no-store" });
        const data = await response.json();
        if (Array.isArray(data.providers)) setProviderModels(Object.fromEntries(data.providers.map((item) => [item.id, item.model || ""])))
      } catch {
        // Static provider labels remain visible when settings are unavailable.
      }
    };
    void loadProviderModels();
    const modelInterval = window.setInterval(loadProviderModels, 10000);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(modelInterval);
    };
  }, [configuredProvider]);

  const visibleServices = reachable
    ? services
    : [{ id: "backend", label: "Backend", online: false }];
  const providerInfo = AI_PROVIDERS.find((item) => item.id === activeProvider);
  const activeModel = providerModels[activeProvider] || providerInfo?.sub || "configured model";

  return (
    <div id={containerId} className={className} role="status" aria-live="polite" aria-label="Live application services">
      {visibleServices.map((service) => {
        const busy = (service.id === "pdf-structure" && pymupdfRequestCount > 0)
          || (["glyph-char", "opencv", "vector-evidence", "layer1-report"].includes(service.id) && glyphCharRequestCount > 0)
          || (service.id === "backend" && backendBackgroundBusy);
        const status = !service.online ? "broken" : busy ? "working" : service.status === "working" ? "working" : "ready";
        return (
          <span
            key={service.id}
            className={`app_footer_service app_footer_service--${status}`}
            title={`${service.label}: ${status}${service.latencyMs ? ` · ${service.latencyMs} ms` : ""}`}
          >
            <i aria-hidden="true" />
            {service.label}
            <small>{status}</small>
          </span>
        );
      })}
      <span className="app_footer_service app_footer_ai_service app_footer_service--ready" title={`Active AI provider: ${providerInfo?.label || activeProvider} · ${activeModel}`}>
        <i aria-hidden="true" />
        AI: {providerInfo?.label || activeProvider} · {activeModel}
        <small>ready</small>
      </span>
    </div>
  );
};

export default ServiceStatusFooter;
