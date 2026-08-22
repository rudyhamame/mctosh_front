import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAIProvider } from "../hooks/useAIProvider";
import "./pdfAssistantFooter.css";

const PDFTextAssistant = lazy(() => import("./PDFTextAssistant"));

const PDFTextAssistantContext = createContext(null);

export const PDFTextAssistantProvider = ({ children }) => {
  const [documentRegistration, setDocumentRegistration] = useState(null);
  const [open, setOpen] = useState(false);
  const documentContext = documentRegistration?.document || null;

  const registerDocument = useCallback((nextDocument) => {
    if (!nextDocument?.loadDocumentPages) return () => {};
    const token = Symbol("pdf-assistant-document");
    setDocumentRegistration({ token, document: nextDocument });
    return () => {
      setDocumentRegistration((current) => current?.token === token ? null : current);
    };
  }, []);

  useEffect(() => {
    if (!documentContext) setOpen(false);
  }, [documentContext]);

  const value = useMemo(() => ({
    documentContext,
    open,
    registerDocument,
    setOpen,
  }), [documentContext, open, registerDocument]);

  return <PDFTextAssistantContext.Provider value={value}>{children}</PDFTextAssistantContext.Provider>;
};

export const usePDFTextAssistant = () => {
  const context = useContext(PDFTextAssistantContext);
  if (!context) throw new Error("usePDFTextAssistant must be used inside PDFTextAssistantProvider.");
  return context;
};

export const PDFTextAssistantFooter = () => {
  const { documentContext, open, setOpen } = usePDFTextAssistant();
  const location = useLocation();
  const { provider: configuredProvider } = useAIProvider();
  const [recentActivity, setRecentActivity] = useState([]);
  const documentKey = documentContext?.sourceId || documentContext?.filename || "pdf";

  useEffect(() => {
    const recordInteraction = (event) => {
      const control = event.target?.closest?.("button, a, [role='button'], [role='menuitem'], [role='tab']");
      if (!control || control.id === "pdf_ai_assistant_fab" || control.closest("#pdf_text_agent_panel")) return;
      const label = String(
        control.getAttribute("aria-label")
        || control.getAttribute("title")
        || control.textContent
        || control.id
        || "",
      ).replace(/\s+/g, " ").trim().slice(0, 120);
      if (!label) return;
      setRecentActivity((previous) => [
        ...previous.slice(-7),
        { action: "activated", control: label, route: `${location.pathname}${location.search}` },
      ]);
    };
    document.addEventListener("click", recordInteraction, true);
    return () => document.removeEventListener("click", recordInteraction, true);
  }, [location.pathname, location.search]);

  const appContext = useMemo(() => ({
    route: `${location.pathname}${location.search}`,
    pageTitle: document.title,
    recentActivity,
    lastOpenedPdf: documentContext ? {
      filename: documentContext.filename,
      currentPage: documentContext.currentPage,
      sourceId: documentContext.sourceId || null,
    } : null,
  }), [documentContext, location.pathname, location.search, recentActivity]);

  return (
    <div className="pdf_assistant_footer_tool">
      {open && (
        <Suspense fallback={null}>
          <PDFTextAssistant
            key={documentKey}
            {...documentContext}
            appContext={appContext}
            hasDocument={Boolean(documentContext?.loadDocumentPages)}
            provider={documentContext?.provider || configuredProvider}
            model={documentContext?.model || ""}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
      <button
        type="button"
        id="pdf_ai_assistant_fab"
        className={open ? "pdf_ai_assistant_fab--active" : undefined}
        onClick={() => setOpen((value) => !value)}
        title={open ? "Close RabbitHole Assistant" : "Open RabbitHole Assistant"}
        aria-label={open ? "Close RabbitHole Assistant" : "Open RabbitHole Assistant"}
        aria-expanded={open}
      >
        <i className={`bx ${open ? "bx-x" : "bx-robot"}`} aria-hidden="true" />
      </button>
    </div>
  );
};
