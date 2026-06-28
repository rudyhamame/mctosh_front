import React, { useCallback, useLayoutEffect, useState } from "react";
import {
  BrowserRouter as Router,
  Redirect,
  Route,
  Switch,
} from "react-router-dom";
import App from "./App/App";
import Login from "./Login/Login";
import AIChat        from "./AI/AIChat";
import PDFPage       from "./PDF/PDFPage";
import PhenomenaPage from "./Phenomena/PhenomenaPage";
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

    // Apply saved zoom scale
    const savedScale = localStorage.getItem("appScale");
    if (savedScale) document.body.style.zoom = savedScale;

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
          {canAccessAuthenticatedRoutes ? (
            <Redirect to="/home" />
          ) : (
            <Login onLogin={handleLogin} onForceLogout={handleLogout} />
          )}
        </Route>
        <Route path="/home">
          {canAccessAuthenticatedRoutes ? (
            <App path="/home" onLogout={handleLogout} />
          ) : (
            <Redirect to="/" />
          )}
        </Route>
        <Route path="/ai">
          {canAccessAuthenticatedRoutes ? (
            <AIChat />
          ) : (
            <Redirect to="/" />
          )}
        </Route>
        <Route path="/pdf">
          {canAccessAuthenticatedRoutes ? (
            <PDFPage />
          ) : (
            <Redirect to="/" />
          )}
        </Route>
        <Route path="/phenomena">
          {canAccessAuthenticatedRoutes ? (
            <PhenomenaPage />
          ) : (
            <Redirect to="/" />
          )}
        </Route>
        <Redirect to={canAccessAuthenticatedRoutes ? "/home" : "/"} />
      </Switch>
    </Router>
  );
};

export default AppRouter;
