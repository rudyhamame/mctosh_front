import React, { createContext, useCallback, useContext, useState } from "react";
import { AVATAR_PROVIDERS } from "./avatarConstants";

// Mirrors useAIProvider.js's own localStorage pattern (see
// src/hooks/useAIProvider.js) — same idea, but exposed through a real React
// Context instead of a plain hook, since HomeChat.jsx's floating panel is
// mounted once, app-wide (see AppRouter.js), and can be open AT THE SAME
// TIME as the Settings page's own avatar-provider card; a plain per-consumer
// hook wouldn't stay in sync between the two if the user changes it from
// Settings while HomeChat is still floating. A context does.
const STORAGE_KEY = "mctosh_avatar_provider";
const VALID_IDS = new Set(Object.values(AVATAR_PROVIDERS));

const readStoredProvider = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Default stays ANAM — existing users see exactly today's behavior until
  // they explicitly pick something else.
  return stored && VALID_IDS.has(stored) ? stored : AVATAR_PROVIDERS.ANAM;
};

const AvatarProviderContext = createContext(null);

export const AvatarProviderContextProvider = ({ children }) => {
  const [provider, setProviderState] = useState(readStoredProvider);

  // "Do not switch providers silently" — this is the one place the
  // selection ever changes, always from an explicit call (the selector UI,
  // or a user picking the offered fallback after a failure — never
  // triggered automatically just because a provider errored).
  const setProvider = useCallback((id) => {
    if (!VALID_IDS.has(id)) return;
    localStorage.setItem(STORAGE_KEY, id);
    setProviderState(id);
  }, []);

  return (
    <AvatarProviderContext.Provider value={{ provider, setProvider }}>
      {children}
    </AvatarProviderContext.Provider>
  );
};

// Throws instead of silently defaulting — every consumer must sit under
// <AvatarProviderContextProvider> (mounted once in AppRouter.js), so a
// missing provider means a real wiring mistake, not a valid runtime state.
export const useAvatarProvider = () => {
  const ctx = useContext(AvatarProviderContext);
  if (!ctx) throw new Error("useAvatarProvider must be used within AvatarProviderContextProvider");
  return ctx;
};
