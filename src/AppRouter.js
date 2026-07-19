import React, { Suspense, lazy, useCallback, useLayoutEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { SplitViewProvider, SplitViewFrame, SplitViewButton } from "./App/SplitView";
import { AvatarProviderContextProvider } from "./Avatar/AvatarProviderContext";
import AppFooter from "./App/AppFooter";
import { clearStoredSession, readStoredSession } from "./utils/sessionCleanup";
import { clearStoredPatientSession, readStoredPatientSession } from "./utils/patientSessionCleanup";
import { applyStoredTheme } from "./utils/theme";

const App = lazy(() => import("./App/App"));
const Login = lazy(() => import("./Login/Login"));
const AIChat = lazy(() => import("./AI/AIChat"));
const HomeChat = lazy(() => import("./App/HomeChat"));
const PredictionOverlay = lazy(() => import("./Prediction/PredictionOverlay"));
const DraftPage = lazy(() => import("./Draft/DraftPage"));
const DraftListPage = lazy(() => import("./Draft/DraftListPage"));
const PDFPage = lazy(() => import("./PDF/PDFPage"));
const PDFReaderWorkspace = lazy(() => import("./PDF/PDFReaderWorkspace"));
const CardPage = lazy(() => import("./Card/CardPage"));
const PhenomenaPage = lazy(() => import("./Phenomena/PhenomenaPage"));
const AboutPage = lazy(() => import("./About/AboutPage"));
const PortfolioPage = lazy(() => import("./Portfolio/PortfolioPage"));
const HylomorphismPage = lazy(() => import("./Hylomorphism/HylomorphismPage"));
const SourcesPage = lazy(() => import("./Sources/SourcesPage"));
const YouTubePage = lazy(() => import("./YouTube/YouTubePage"));
const YouTubeSourcePage = lazy(() => import("./Hylomorphism/YouTubeSourcePage"));
const SettingsPage = lazy(() => import("./Settings/SettingsPage"));
const VoiceProfilePage = lazy(() => import("./VoiceProfile/VoiceProfilePage"));
const PatientInstantiationPage = lazy(() => import("./PatientInstantiation/PatientInstantiationPage"));
const ClinicalSchemata = lazy(() => import("./ClinicalSchemata/ClinicalSchemata"));
const MCCQEObjectivesPage = lazy(() => import("./MCC/MCCQEObjectivesPage"));
const SocialMediaControlPage = lazy(() => import("./SocialMediaControl/SocialMediaControlPage"));
const InstagramHomePreviewPage = lazy(() => import("./SocialMediaControl/InstagramHomePreviewPage"));
const SocialMediaDesignerPage = lazy(() => import("./SocialMediaControl/SocialMediaDesignerPage"));
const HumanAtlasPage = lazy(() => import("./HumanAtlas/HumanAtlasPage"));
const FreeformPage = lazy(() => import("./Freeform/FreeformPage"));
const FreeformListPage = lazy(() => import("./Freeform/FreeformListPage"));
const ClinicalVignetteGeneratorPage = lazy(() => import("./ClinicalVignetteGenerator/ClinicalVignetteGeneratorPage"));
const MedicalExamsPage = lazy(() => import("./MedicalExams/MedicalExamsPage"));
const PatientLoginPage = lazy(() => import("./PatientApp/PatientLoginPage"));
const PatientSignupPage = lazy(() => import("./PatientApp/PatientSignupPage"));
const PatientCallPage = lazy(() => import("./PatientApp/PatientCallPage"));
const PatientSettingsPage = lazy(() => import("./PatientApp/PatientSettingsPage"));

const getStoredAuth = () => readStoredSession();
const getStoredPatientAuth = () => readStoredPatientSession();

const RouteFallback = () => <div id="route_loading" aria-hidden="true" />;

// Legacy redirect: /pdf/:card → /card/:card
const PdfCardRedirect = () => {
  const { card } = useParams();
  return <Navigate to={`/card/${card}`} replace />;
};

// Home renders its own Dev AI trigger docked inside the 3D canvas (see
// App.js) instead of the app-wide footer strip — a bottom toolbar has
// nowhere to sit over a full-bleed scroll stage. Every other authenticated
// page keeps the footer (Dev AI + split view) exactly as before; this only
// suppresses it on that one route. Needs useLocation, which only works
// inside the <Router> below, so it can't live directly in AppRouter itself.
const FooterGate = ({ children }) => {
  const location = useLocation();
  if (location.pathname === "/home") return null;
  return children;
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

  // Parallel, independent auth for the patient-facing app — separate
  // storage key ("patient_state" vs "state") and separate JWT secret
  // (PATIENT_JWT_KEY on the backend) so a patient session can coexist in
  // the same browser as a clinician session without either clobbering or
  // being usable as the other.
  const [patientAuthState, setPatientAuthState] = useState(getStoredPatientAuth);
  const canAccessPatientRoutes = patientAuthState?.isLoggedIn === true;

  const handlePatientLogin = useCallback((nextAuthState) => {
    setPatientAuthState(nextAuthState);
  }, []);

  const handlePatientLogout = useCallback(() => {
    clearStoredPatientSession();
    setPatientAuthState(null);
  }, []);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;

    const savedScale = localStorage.getItem("appScale");
    if (savedScale) document.body.style.zoom = savedScale;

    applyStoredTheme();

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

  const authPatient = (element) =>
    canAccessPatientRoutes ? element : <Navigate to="/patient/login" replace />;

  const withSuspense = (element) => (
    <Suspense fallback={<RouteFallback />}>
      {element}
    </Suspense>
  );

  return (
    // AMCTOSHS | CVS is a sub-app of the future MCTOSH product — mounted at
    // /cvs/ instead of the domain root, so mctoshs.ca/cvs/login is the main page.
    <Router basename="/cvs" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AvatarProviderContextProvider>
      <SplitViewProvider>
      <SplitViewFrame>
      <Routes>
        <Route path="/" element={
          <Navigate to={canAccessAuthenticatedRoutes ? "/home" : "/login"} replace />
        } />

        <Route path="/about"     element={withSuspense(<AboutPage />)} />
        <Route path="/portfolio" element={withSuspense(<PortfolioPage />)} />
        <Route path="/mcc/mccqe/objectives" element={withSuspense(<MCCQEObjectivesPage />)} />

        <Route path="/login" element={
          canAccessAuthenticatedRoutes
            ? <Navigate to="/home" replace />
            : withSuspense(<Login onLogin={handleLogin} onForceLogout={handleLogout} />)
        } />

        <Route path="/home"               element={auth(withSuspense(<App onLogout={handleLogout} />))} />
        <Route path="/hylomorphism/youtube_source" element={auth(withSuspense(<YouTubeSourcePage />))} />
        <Route path="/hylomorphism/pdf_source"     element={auth(withSuspense(<PDFPage />))} />
        <Route path="/hylomorphism"       element={auth(withSuspense(<HylomorphismPage />))} />
        <Route path="/pdf-reader"         element={auth(withSuspense(<PDFReaderWorkspace />))} />
        <Route path="/sources"            element={auth(withSuspense(<SourcesPage />))} />
        <Route path="/voice-profile"      element={auth(withSuspense(<VoiceProfilePage />))} />
        <Route path="/youtube"            element={auth(withSuspense(<YouTubePage />))} />
        <Route path="/ai"                 element={auth(withSuspense(<AIChat />))} />
        <Route path="/card/:card"         element={auth(withSuspense(<CardPage />))} />
        <Route path="/phenomena"          element={auth(withSuspense(<PhenomenaPage />))} />
        <Route path="/settings"           element={auth(withSuspense(<SettingsPage />))} />
        <Route path="/draft"              element={auth(withSuspense(<DraftListPage />))} />
        <Route path="/draft/:id"          element={auth(withSuspense(<DraftPage />))} />
        <Route path="/patient-instantiation" element={auth(withSuspense(<PatientInstantiationPage />))} />
        <Route path="/clinical-schemata"      element={auth(withSuspense(<ClinicalSchemata />))} />
        <Route path="/social-media-control"   element={auth(withSuspense(<SocialMediaControlPage />))} />
        <Route path="/instagram-home-preview" element={auth(withSuspense(<InstagramHomePreviewPage />))} />
        <Route path="/social-media-designer"  element={auth(withSuspense(<SocialMediaDesignerPage />))} />
        <Route path="/human-atlas"            element={auth(withSuspense(<HumanAtlasPage />))} />
        <Route path="/freeform"               element={auth(withSuspense(<FreeformListPage />))} />
        <Route path="/clinical-vignettes"     element={auth(withSuspense(<ClinicalVignetteGeneratorPage />))} />
        <Route path="/medical-exams"          element={auth(withSuspense(<MedicalExamsPage />))} />
        <Route path="/freeform/:id"           element={auth(withSuspense(<FreeformPage />))} />

        {/* Patient-facing app — separate account system, separate auth
            gate (authPatient/canAccessPatientRoutes), independent of the
            clinician auth above. */}
        <Route path="/patient/login" element={
          canAccessPatientRoutes
            ? <Navigate to="/patient/call" replace />
            : withSuspense(<PatientLoginPage onLogin={handlePatientLogin} />)
        } />
        <Route path="/patient/signup" element={
          canAccessPatientRoutes
            ? <Navigate to="/patient/call" replace />
            : withSuspense(<PatientSignupPage onLogin={handlePatientLogin} />)
        } />
        <Route path="/patient/call" element={authPatient(withSuspense(<PatientCallPage />))} />
        <Route path="/patient/settings" element={authPatient(withSuspense(<PatientSettingsPage onLogout={handlePatientLogout} />))} />

        {/* Legacy redirect */}
        <Route path="/pdf/:card" element={<PdfCardRedirect />} />

        <Route path="*" element={
          <Navigate to={canAccessAuthenticatedRoutes ? "/home" : "/login"} replace />
        } />
      </Routes>
      </SplitViewFrame>

      {canAccessAuthenticatedRoutes && (
        <FooterGate>
          <AppFooter>
            {withSuspense(<HomeChat />)}
            <SplitViewButton />
          </AppFooter>
        </FooterGate>
      )}
      {canAccessAuthenticatedRoutes && withSuspense(<PredictionOverlay />)}
      </SplitViewProvider>
      </AvatarProviderContextProvider>
    </Router>
  );
};

export default AppRouter;
