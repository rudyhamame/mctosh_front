import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { useAvatarProvider } from "./AvatarProviderContext";
import { AVATAR_PROVIDERS } from "./avatarConstants";
import AnamAvatarView from "./AnamAvatarView";
import Local3DAvatarView from "./local3d/Local3DAvatarView";

// Renders exactly one provider view at a time — switching providers is a
// plain React unmount+mount, which is already the correct cleanup for both
// sides (AnamAvatarView's wrapped AnamAvatar.jsx ends its session on
// unmount via its own existing effect; Local3DAvatarView stops its own
// audio/rAF loop on unmount). Forwards every imperative call to whichever
// is currently mounted, so HomeChat.jsx's own call sites
// (streamChunk/endMessage/isLive — unchanged) never need to know which
// provider is actually active.
const AvatarContainer = forwardRef((_props, ref) => {
  const { provider } = useAvatarProvider();
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    isLive: () => innerRef.current?.isLive?.() ?? false,
    streamChunk: (text) => innerRef.current?.streamChunk?.(text),
    endMessage: () => innerRef.current?.endMessage?.(),
    initialize: () => innerRef.current?.initialize?.(),
    pause: () => innerRef.current?.pause?.(),
    resume: () => innerRef.current?.resume?.(),
    stop: () => innerRef.current?.stop?.(),
    setMuted: (muted) => innerRef.current?.setMuted?.(muted),
    destroy: () => innerRef.current?.destroy?.(),
  }), [provider]);

  if (provider === AVATAR_PROVIDERS.LOCAL3D) {
    return <Local3DAvatarView ref={innerRef} />;
  }
  return <AnamAvatarView ref={innerRef} />;
});

AvatarContainer.displayName = "AvatarContainer";

export default AvatarContainer;
