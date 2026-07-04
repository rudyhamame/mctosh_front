import React, { useCallback, useLayoutEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import App from "./App/App";
import Login from "./Login/Login";
import AIChat                         from "./AI/AIChat";
import HomeChat                       from "./App/HomeChat";
import PDFPage                        from "./PDF/PDFPage";
import CardPage                       from "./Card/CardPage";
import PhenomenaPage                  from "./Phenomena/PhenomenaPage";
import AboutPage                      from "./About/AboutPage";
import PortfolioPage                  from "./Portfolio/PortfolioPage";
import HylomorphismPage               from "./Hylomorphism/HylomorphismPage";
import SourcesPage                    from "./Sources/SourcesPage";
import YouTubePage                    from "./YouTube/YouTubePage";
import YouTubeSourcePage              from "./Hylomorphism/YouTubeSourcePage";
import SettingsPage                   from "./Settings/SettingsPage";
import PatientInstantiationPage       from "./PatientInstantiation/PatientInstantiationPage";
import PatientModelling               from "./PatientModelling/PatientModelling";
import TracesCollector                from "./TracesCollector/TracesCollector";
import ClinicalSchemata              from "./ClinicalSchemata/ClinicalSchemata";
import UnitsExtraction                from "./UnitsExtraction/UnitsExtraction";
import { clearStoredSession, readStoredSession } from "./utils/sessionCleanup";

const getStoredAuth = () => readStoredSession();

// Legacy redirect: /pdf/:card → /card/:card
const PdfCardRedirect = () => {
  const { card } = useParams();
  return <Navigate to={`/card/${card}`} replace />;
};

const AppRouter = () => {
  const [authState, setAuthState] = useState(getStoredAuth);

  const isAuthenticated =
    authState?.isLoggedIn === true || authState?.isConnected === true;
  const profileIsAllowed = authState?.profileCompleted !== false;
  const canAccessAuthenticatedRoutes = isAuthenticated && profileIsAllowed;

  const handleLogin = useCallback((nextAuthState) => {
    setAuthState(nextAuthState);
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    setAuthState(null);
  }, []);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;

    const savedScale = localStorage.getItem("appScale");
    if (savedScale) document.body.style.zoom = savedScale;

    const savedTheme = localStorage.getItem("mctosh_theme") || "original";
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (savedTheme === "light") document.documentElement.classList.add("theme-light");
    if (savedTheme === "dark")  document.documentElement.classList.add("theme-dark");

    const rootElement = document.documentElement;
    const setVh = () =>
      rootElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);

    setVh();
    window.addEventListener("resize", setVh);
    window.addEventListener("orientationchange", setVh);

    return () => {
      window.removeEventListener("resize", setVh);
      window.removeEventListener("orientationchange", setVh);
      rootElement.style.removeProperty("--vh");
    };
  }, []);

  const auth = (element) =>
    canAccessAuthenticatedRoutes ? element : <Navigate to="/login" replace />;

  return (
    // MCTOSHS | CS is a sub-app of the future MCTOSH product — mounted at
    // /cs/ instead of the domain root, so mctoshs.ca/cs/login is the main page.
    <Router basename="/cs">
      <Routes>
        <Route path="/" element={
          <Navigate to={canAccessAuthenticatedRoutes ? "/home" : "/login"} replace />
        } />

        <Route path="/about"     element={<AboutPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />

        <Route path="/login" element={
          canAccessAuthenticatedRoutes
            ? <Navigate to="/home" replace />
            : <Login onLogin={handleLogin} onForceLogout={handleLogout} />
        } />

        <Route path="/home"               element={auth(<App onLogout={handleLogout} />)} />
        <Route path="/hylomorphism/youtube_source" element={auth(<YouTubeSourcePage />)} />
        <Route path="/hylomorphism/pdf_source"     element={auth(<PDFPage />)} />
        <Route path="/hylomorphism"       element={auth(<HylomorphismPage />)} />
        <Route path="/sources"            element={auth(<SourcesPage />)} />
        <Route path="/youtube"            element={auth(<YouTubePage />)} />
        <Route path="/ai"                 element={auth(<AIChat />)} />
        <Route path="/card/:card"         element={auth(<CardPage />)} />
        <Route path="/phenomena"          element={auth(<PhenomenaPage />)} />
        <Route path="/settings"           element={auth(<SettingsPage />)} />
        <Route path="/patient-instantiation" element={auth(<PatientInstantiationPage />)} />
        <Route path="/patient-modelling"     element={auth(<PatientModelling />)} />
        <Route path="/traces-collector"      element={auth(<TracesCollector />)} />
        <Route path="/clinical-schemata"      element={auth(<ClinicalSchemata />)} />
        <Route path="/units-extraction"       element={auth(<UnitsExtraction />)} />

        {/* Legacy redirect */}
        <Route path="/pdf/:card" element={<PdfCardRedirect />} />

        <Route path="*" element={
          <Navigate to={canAccessAuthenticatedRoutes ? "/home" : "/login"} replace />
        } />
      </Routes>

      {canAccessAuthenticatedRoutes && <HomeChat />}
    </Router>
  );
};

export default AppRouter;
