import React, { useCallback, useLayoutEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Redirect,
  Route,
  Switch,
} from "react-router-dom";
import App from "./App/App";
import Login from "./Login/Login";
import AIChat            from "./AI/AIChat";
import PDFPage           from "./PDF/PDFPage";
import CardPage          from "./Card/CardPage";
import PhenomenaPage     from "./Phenomena/PhenomenaPage";
import AboutPage         from "./About/AboutPage";
import HylomorphismPage  from "./Hylomorphism/HylomorphismPage";
import SourcesPage       from "./Sources/SourcesPage";
import StudyRoom           from "./Study/StudyRoom";
import YouTubePage         from "./YouTube/YouTubePage";
import YouTubeSourcePage   from "./Hylomorphism/YouTubeSourcePage";
import SettingsPage         from "./Settings/SettingsPage";
import { clearStoredSession, readStoredSession } from "./utils/sessionCleanup";

const getStoredAuth = () => readStoredSession();

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

  return (
    <Router>
      <Switch>
        <Route exact path="/">
          <Redirect to={canAccessAuthenticatedRoutes ? "/home" : "/login"} />
        </Route>
        <Route path="/about">
          <AboutPage />
        </Route>
        <Route path="/login">
          {canAccessAuthenticatedRoutes ? (
            <Redirect to="/home" />
          ) : (
            <Login onLogin={handleLogin} onForceLogout={handleLogout} />
          )}
        </Route>
        <Route path="/home">
          {canAccessAuthenticatedRoutes ? (
            <App onLogout={handleLogout} />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/hylomorphism/youtube_source">
          {canAccessAuthenticatedRoutes ? (
            <YouTubeSourcePage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/hylomorphism/pdf_source">
          {canAccessAuthenticatedRoutes ? (
            <PDFPage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/hylomorphism">
          {canAccessAuthenticatedRoutes ? (
            <HylomorphismPage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/sources">
          {canAccessAuthenticatedRoutes ? (
            <SourcesPage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/representation">
          {canAccessAuthenticatedRoutes ? (
            <StudyRoom />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/youtube">
          {canAccessAuthenticatedRoutes ? (
            <YouTubePage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/ai">
          {canAccessAuthenticatedRoutes ? (
            <AIChat />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/card/:card">
          {canAccessAuthenticatedRoutes ? (
            <CardPage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/phenomena">
          {canAccessAuthenticatedRoutes ? (
            <PhenomenaPage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        <Route path="/settings">
          {canAccessAuthenticatedRoutes ? (
            <SettingsPage />
          ) : (
            <Redirect to="/login" />
          )}
        </Route>
        {/* Legacy redirect — keep old /pdf/:card links working */}
        <Route path="/pdf/:card" render={({ match }) => (
          <Redirect to={`/card/${match.params.card}`} />
        )} />
        <Redirect to={canAccessAuthenticatedRoutes ? "/home" : "/login"} />
      </Switch>
    </Router>
  );
};

export default AppRouter;
