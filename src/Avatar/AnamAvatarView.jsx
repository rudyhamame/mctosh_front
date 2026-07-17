import React, { forwardRef, useImperativeHandle, useRef } from "react";
import AnamAvatar from "../App/AnamAvatar";

// Thin adapter over the EXISTING, UNMODIFIED <AnamAvatar/> (see
// src/App/AnamAvatar.jsx — not touched by this file or anything it imports)
// so it can sit behind AvatarContainer's shared provider interface next to
// Local3DAvatarView. Every call AnamAvatar.jsx already supports
// (isLive/streamChunk/endMessage) is forwarded straight through unchanged;
// the handful of interface methods it has no equivalent for (pause/resume/
// stop/setMuted/destroy — Anam's own client isn't reachable from outside
// AnamAvatar.jsx, and adding new props to it wasn't worth the risk to
// "preserve its behavior exactly") are safe no-ops/best-effort DOM
// workarounds rather than reimplementations of Anam internals — nothing in
// this app's actual call sites (HomeChat.jsx) uses them for the Anam path
// today anyway, only isLive/streamChunk/endMessage are ever called.
const ANAM_VIDEO_ELEMENT_ID = "anam_avatar_video"; // matches AnamAvatar.jsx's own VIDEO_ELEMENT_ID constant

const AnamAvatarView = forwardRef((_props, ref) => {
  const innerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    isLive: () => innerRef.current?.isLive?.() ?? false,
    streamChunk: (text) => innerRef.current?.streamChunk?.(text),
    endMessage: () => innerRef.current?.endMessage?.(),
    initialize: async () => {
      // AnamAvatar connects on its own mount effect — nothing to trigger here.
    },
    pause: () => {
      // No exposed pause on Anam's client from outside AnamAvatar.jsx.
    },
    resume: () => {
      // No exposed resume on Anam's client from outside AnamAvatar.jsx.
    },
    stop: () => {
      // No exposed interrupt on Anam's client from outside AnamAvatar.jsx.
    },
    setMuted: (muted) => {
      const video = document.getElementById(ANAM_VIDEO_ELEMENT_ID);
      if (video) video.muted = Boolean(muted);
    },
    destroy: () => {
      // Unmounting this component (AvatarContainer swaps providers by
      // conditional render) already triggers AnamAvatar.jsx's own cleanup
      // effect, which calls clientRef.current?.stopStreaming() — the exact
      // "end the paid session" behavior this method exists for.
    },
  }), []);

  return <AnamAvatar ref={innerRef} />;
});

AnamAvatarView.displayName = "AnamAvatarView";

export default AnamAvatarView;
