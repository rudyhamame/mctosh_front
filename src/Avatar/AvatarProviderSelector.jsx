import React from "react";
import { useAvatarProvider } from "./AvatarProviderContext";
import { AVATAR_PROVIDER_LIST } from "./avatarConstants";
import "./avatarProviderSelector.css";

// The [ANAM] [Local 3D Avatar] control — used both compactly (HomeChat's
// own control row, see HomeChat.jsx) and full-sized (Settings → AI
// Providers, see SettingsPage.jsx). Both read/write the same shared
// AvatarProviderContext, so picking one here is immediately reflected
// wherever the avatar is actually showing — "do not switch providers
// silently" only applies to automatic switches; this IS the explicit
// user action the spec means by that.
const AvatarProviderSelector = ({ compact = false }) => {
  const { provider, setProvider } = useAvatarProvider();

  if (compact) {
    return (
      <div className="avatar_provider_selector avatar_provider_selector--compact">
        {AVATAR_PROVIDER_LIST.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`avatar_provider_pill${provider === id ? " avatar_provider_pill--active" : ""}`}
            onClick={() => setProvider(id)}
            title={label}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="avatar_provider_selector">
      <span className="avatar_provider_selector_label">Avatar provider</span>
      <div className="avatar_provider_cards">
        {AVATAR_PROVIDER_LIST.map(({ id, label, sub }) => (
          <div
            key={id}
            className={`avatar_provider_card${provider === id ? " avatar_provider_card--active" : ""}`}
            onClick={() => setProvider(id)}
          >
            <span className="avatar_provider_card_label">{label}</span>
            <span className="avatar_provider_card_sub">{sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AvatarProviderSelector;
