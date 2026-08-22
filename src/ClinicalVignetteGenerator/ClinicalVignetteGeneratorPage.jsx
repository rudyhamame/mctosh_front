import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./clinicalVignetteGenerator.css";
import ClinicalVignetteBuilderPanel from "../PDF/ClinicalVignetteBuilderPanel";
import { apiUrl } from "../config/api";
import { useAIProvider } from "../hooks/useAIProvider";
import { readStoredSession } from "../utils/sessionCleanup";

const authHeaders = () => {
  const session = readStoredSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
};

export default function ClinicalVignetteGeneratorPage() {
  const navigate = useNavigate();
  const { provider } = useAIProvider();
  const [providerModels, setProviderModels] = useState({});

  useEffect(() => {
    let cancelled = false;

    fetch(apiUrl("/api/settings/ai-status"), { headers: authHeaders() })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled || !data || typeof data !== "object") return;
        const nextModels = {};
        Object.entries(data).forEach(([providerId, info]) => {
          if (info?.model) nextModels[providerId] = info.model;
        });
        setProviderModels(nextModels);
      })
      .catch(() => {
        if (!cancelled) setProviderModels({});
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div id="cvg_root">
      <div id="cvg_header">
        <button type="button" id="cvg_back" onClick={() => navigate("/")} title="Back to tools">
          <i className="bx bx-arrow-back" />
        </button>
        <div id="cvg_header_titles">
          <div id="cvg_title">ACMTOSHS Tools</div>
          <div id="cvg_subtitle">RabbitHole Clinical Vignette Generator</div>
        </div>
      </div>

      <div id="cvg_body">
        <ClinicalVignetteBuilderPanel
          standalone
          provider={provider === "manual" ? "groq" : provider}
          providerModels={providerModels}
        />
      </div>
    </div>
  );
}
