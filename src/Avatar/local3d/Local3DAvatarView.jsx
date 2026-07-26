import React, { Component, forwardRef, Suspense, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import AvatarModel from "./AvatarModel";
import AvatarController from "./AvatarController";
import { createLocalAvatarSpeechService } from "./services/localAvatarSpeechService";
import { createBrowserTTSProvider } from "./services/ttsProviders/BrowserTTSProvider";
import { createOpenVoiceCloneProvider } from "./services/ttsProviders/OpenVoiceCloneProvider";
import { createKokoroTTSProvider } from "./services/ttsProviders/KokoroTTSProvider";
import { createSupertonicTTSProvider } from "./services/ttsProviders/SupertonicTTSProvider";
import { readVoiceSettings, TTS_PROVIDERS, readTtsProviderId } from "./ttsProviderSettings";
import { AVATAR_POSE_UPDATED_EVENT, readSavedPose } from "./avatarPoseSettings";
import {
  AVATAR_VIEWPORT_UPDATED_EVENT,
  DEFAULT_VIEWPORT_FRAME,
  MIN_VIEWPORT_ZOOM,
  MAX_VIEWPORT_ZOOM,
  normalizeViewportFrame,
  readSavedViewportFrame,
  writeSavedViewportFrame,
} from "./avatarViewportSettings";
import "./local3dAvatarView.css";
import { useEffect } from "react";
import { apiUrl } from "../../config/api";
import { readStoredSession } from "../../utils/sessionCleanup";

// Fixed path the user drops their own rigged .glb into — see the plan this
// feature was built from. One constant, trivial to change or make
// configurable later; nothing else in this file assumes anything about the
// model beyond "a glTF scene, maybe with morph targets/bones AvatarModel.jsx
// can detect." Built through BASE_URL (same pattern as TalkingHead.jsx and
// SymptomBodyMapPanel.jsx) rather than a hardcoded leading slash — this app
// is served from /cvs/ (see vite.config's own base), so a literal
// "/models/..." path 404s in every real deployment even though the file is
// sitting right there in public/.
const LOCAL_3D_AVATAR_MODEL_URL = `${import.meta.env.BASE_URL}models/avatar/avatar.glb`;
const SPEECH_ACTIVITY_DECAY_MS = 220;
const VIEWPORT_PAN_SCALE = 0.005;
const FRAME_EPSILON = 0.0001;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const framesMatch = (a, b) => (
  Math.abs((a?.offsetX || 0) - (b?.offsetX || 0)) < FRAME_EPSILON &&
  Math.abs((a?.offsetY || 0) - (b?.offsetY || 0)) < FRAME_EPSILON &&
  Math.abs((a?.zoom || 1) - (b?.zoom || 1)) < FRAME_EPSILON
);


const createTtsProviderFor = (providerId) => {
  if (providerId === TTS_PROVIDERS.OPENVOICE) return createOpenVoiceCloneProvider();
  if (providerId === TTS_PROVIDERS.KOKORO) return createKokoroTTSProvider();
  if (providerId === TTS_PROVIDERS.SUPERTONIC) return createSupertonicTTSProvider();
  return createBrowserTTSProvider();
};

// React has no functional/hook equivalent of an error boundary (still true
// as of React 19 — componentDidCatch has no hook form) — this is the one
// necessary exception to this codebase's plain-function convention, kept
// tiny and scoped to exactly this one job: catching AvatarModel's load
// failure (a bad/missing .glb) so it shows a readable status instead of
// crashing the rest of the app. Full error goes to console, not the UI.
class ModelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("[Local3DAvatar] failed to load avatar model:", error);
    this.props.onError?.(error);
  }
  render() {
    if (this.state.failed) return this.props.fallback || null;
    return this.props.children;
  }
}

// Frames a portrait centered exactly on portraitTarget (see AvatarModel.jsx
// — a point derived purely from the model's own real mesh bounding box, not
// a bone-pivot guess), sized relative to the model's own real height, not a
// fixed position guessed for one file. Camera and lookAt target share the
// same X/Y, only offset in Z, so the target point lands dead-center in
// frame rather than needing hand-tuned vertical offsets. Applied once (the
// ref guard) since neither value changes after the model finishes loading;
// re-running it every frame would fight anything else that ever wants to
// move the camera (e.g. a future look-around effect).
const PortraitCamera = ({ portraitTarget, modelHeight, viewportFrameRef }) => {
  const { camera } = useThree();

  useFrame(() => {
    if (!portraitTarget) return;
    const viewportFrame = viewportFrameRef.current || DEFAULT_VIEWPORT_FRAME;
    const distance = Math.max(0.9, modelHeight * 0.96) / clamp(viewportFrame.zoom || 1, MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM);
    const targetX = portraitTarget.x + viewportFrame.offsetX;
    const targetY = portraitTarget.y - (modelHeight * 0.22) + viewportFrame.offsetY;
    camera.position.set(targetX, targetY, portraitTarget.z + distance);
    camera.lookAt(targetX, targetY, portraitTarget.z);
    if (camera.isPerspectiveCamera) camera.updateProjectionMatrix();
  });

  return null;
};

const Local3DAvatarView = forwardRef(({ allowViewportControls = true, onSpeechCaptionChange = null }, ref) => {
  // idle | initializing | ready | speaking | paused | error | model-not-found
  const [status, setStatus] = useState("initializing");
  const [expression, setExpression] = useState("neutral");
  const [frameDirty, setFrameDirty] = useState(false);
  const modelStateRef = useRef(null); // { root, meshesWithMorphs, standardToReal }
  const lipSyncRef = useRef(null);    // { onAmplitude, onViseme } from AvatarController
  const speechExpressionRef = useRef({
    isSynthesizing: false,
    isSpeaking: false,
    speakingAmount: 0,
    emphasis: 0,
  });
  const activeTtsProviderIdRef = useRef(readTtsProviderId());
  const speechServiceRef = useRef(createLocalAvatarSpeechService(createTtsProviderFor(activeTtsProviderIdRef.current)));
  const pendingTextRef = useRef("");  // buffered across streamChunk() calls until endMessage() flushes it
  const mutedRef = useRef(false);
  const viewportFrameRef = useRef(readSavedViewportFrame());
  const savedViewportFrameRef = useRef({ ...viewportFrameRef.current });
  const postureRef = useRef(readSavedPose());
  const gestureRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    baseFrame: { ...viewportFrameRef.current },
    pinchDistance: null,
    pinchCenterX: 0,
    pinchCenterY: 0,
  });
  const touchPointsRef = useRef(new Map());
  const viewportRef = useRef(null);
  const viewportHydratedFromDbRef = useRef(false);

  const updateSpeechExpression = useCallback((patch) => {
    speechExpressionRef.current = { ...speechExpressionRef.current, ...patch };
  }, []);

  const updateFrameDirty = useCallback(() => {
    setFrameDirty(!framesMatch(viewportFrameRef.current, savedViewportFrameRef.current));
  }, []);

  const applyViewportFrame = useCallback((nextFrame) => {
    viewportFrameRef.current = normalizeViewportFrame(nextFrame);
    updateFrameDirty();
  }, [updateFrameDirty]);

  const resetViewportFrame = useCallback((frame) => {
    viewportFrameRef.current = normalizeViewportFrame(frame);
    updateFrameDirty();
  }, [updateFrameDirty]);

  useEffect(() => {
    const handlePoseUpdate = (event) => {
      const nextPose = event?.detail && typeof event.detail === "object" ? event.detail : readSavedPose();
      postureRef.current = { ...nextPose };
    };

    const handleViewportUpdate = (event) => {
      const nextFrame = event?.detail && typeof event.detail === "object" ? event.detail : readSavedViewportFrame();
      viewportFrameRef.current = normalizeViewportFrame(nextFrame);
      savedViewportFrameRef.current = { ...viewportFrameRef.current };
      setFrameDirty(false);
    };

    window.addEventListener(AVATAR_POSE_UPDATED_EVENT, handlePoseUpdate);
    window.addEventListener(AVATAR_VIEWPORT_UPDATED_EVENT, handleViewportUpdate);
    return () => {
      window.removeEventListener(AVATAR_POSE_UPDATED_EVENT, handlePoseUpdate);
      window.removeEventListener(AVATAR_VIEWPORT_UPDATED_EVENT, handleViewportUpdate);
    };
  }, []);

  useEffect(() => {
    const token = readStoredSession()?.token || "";
    if (!token || viewportHydratedFromDbRef.current) return;
    viewportHydratedFromDbRef.current = true;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(apiUrl("/api/user/me/local3d-viewport"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const nextFrame = writeSavedViewportFrame(data.local3dViewport || DEFAULT_VIEWPORT_FRAME);
        savedViewportFrameRef.current = { ...nextFrame };
        viewportFrameRef.current = { ...nextFrame };
        setFrameDirty(false);
      } catch {
        // Keep the local fallback if the DB-backed setting can't be loaded.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-reads the provider setting fresh on every turn (same pattern
  // readVoiceSettings() already uses) and swaps the underlying service only
  // when it actually changed, so switching providers on the Settings page
  // takes effect on the avatar's very next reply without needing a remount.
  const getSpeechService = useCallback(() => {
    const nextId = readTtsProviderId();
    if (nextId !== activeTtsProviderIdRef.current) {
      speechServiceRef.current.stop();
      activeTtsProviderIdRef.current = nextId;
      speechServiceRef.current = createLocalAvatarSpeechService(createTtsProviderFor(nextId));
    }
    return speechServiceRef.current;
  }, []);

  // modelStateRef is a ref, not state — but it's still safe to read in JSX
  // below: the assignment happens synchronously, one line before the
  // setStatus() call that actually triggers the re-render gating on it, so
  // by the time React re-renders, the ref is already populated. Avoids
  // storing the same {root, meshesWithMorphs, standardToReal} object in
  // React state (it never needs to trigger a render on its own — only
  // "ready or not" does, and status already covers that).
  const handleModelReady = useCallback((state) => {
    modelStateRef.current = state;
    setStatus("ready");
  }, []);

  const handleModelError = useCallback(() => {
    setStatus("model-not-found");
  }, []);

  const handleLipSyncReady = useCallback((handles) => {
    lipSyncRef.current = handles;
  }, []);

  const handleSaveViewportFrame = useCallback(async () => {
    const nextFrame = writeSavedViewportFrame(viewportFrameRef.current);
    savedViewportFrameRef.current = { ...nextFrame };
    setFrameDirty(false);
    const token = readStoredSession()?.token || "";
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/api/user/me/local3d-viewport"), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ local3dViewport: nextFrame }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save Local 3D viewport.");
      const persistedFrame = writeSavedViewportFrame(data.local3dViewport || nextFrame);
      savedViewportFrameRef.current = { ...persistedFrame };
      setFrameDirty(false);
    } catch {
      // Preserve the just-saved local frame even if the DB update fails.
    }
  }, []);

  const handleIgnoreViewportFrame = useCallback(() => {
    savedViewportFrameRef.current = { ...viewportFrameRef.current };
    setFrameDirty(false);
  }, []);

  const beginSinglePointerPan = useCallback((pointerId, clientX, clientY) => {
    gestureRef.current.pointerId = pointerId;
    gestureRef.current.startX = clientX;
    gestureRef.current.startY = clientY;
    gestureRef.current.baseFrame = { ...viewportFrameRef.current };
    gestureRef.current.pinchDistance = null;
  }, []);

  const updateSinglePointerPan = useCallback((clientX, clientY) => {
    if (!modelStateRef.current) return;
    const width = viewportRef.current?.clientWidth || 1;
    const height = viewportRef.current?.clientHeight || 1;
    const scale = Math.max(0.6, modelStateRef.current.modelHeight * 0.7) / clamp(viewportFrameRef.current.zoom, MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM);
    const dx = clientX - gestureRef.current.startX;
    const dy = clientY - gestureRef.current.startY;
    applyViewportFrame({
      ...gestureRef.current.baseFrame,
      offsetX: DEFAULT_VIEWPORT_FRAME.offsetX,
      offsetY: gestureRef.current.baseFrame.offsetY + (dy / height) * scale * VIEWPORT_PAN_SCALE * height,
      zoom: gestureRef.current.baseFrame.zoom,
    });
  }, [applyViewportFrame]);

  const beginPinch = useCallback(() => {
    const points = Array.from(touchPointsRef.current.values());
    if (points.length < 2) return;
    const [a, b] = points;
    gestureRef.current.baseFrame = { ...viewportFrameRef.current };
    gestureRef.current.pinchDistance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1;
    gestureRef.current.pinchCenterX = (a.clientX + b.clientX) / 2;
    gestureRef.current.pinchCenterY = (a.clientY + b.clientY) / 2;
  }, []);

  const updatePinch = useCallback(() => {
    if (!modelStateRef.current) return;
    const points = Array.from(touchPointsRef.current.values());
    if (points.length < 2 || !gestureRef.current.pinchDistance) return;
    const [a, b] = points;
    const nextDistance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || gestureRef.current.pinchDistance;
    const zoomRatio = nextDistance / gestureRef.current.pinchDistance;
    const nextZoom = clamp(gestureRef.current.baseFrame.zoom * zoomRatio, MIN_VIEWPORT_ZOOM, MAX_VIEWPORT_ZOOM);
    const centerX = (a.clientX + b.clientX) / 2;
    const centerY = (a.clientY + b.clientY) / 2;
    const width = viewportRef.current?.clientWidth || 1;
    const height = viewportRef.current?.clientHeight || 1;
    const scale = Math.max(0.6, modelStateRef.current.modelHeight * 0.7) / nextZoom;
    applyViewportFrame({
      offsetX: DEFAULT_VIEWPORT_FRAME.offsetX,
      offsetY: gestureRef.current.baseFrame.offsetY + ((centerY - gestureRef.current.pinchCenterY) / height) * scale * VIEWPORT_PAN_SCALE * height,
      zoom: nextZoom,
    });
  }, [applyViewportFrame]);

  const onPointerDown = useCallback((event) => {
    if (!allowViewportControls) return;
    if (event.pointerType === "touch") {
      touchPointsRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touchPointsRef.current.size === 1) {
        beginSinglePointerPan(event.pointerId, event.clientX, event.clientY);
      } else if (touchPointsRef.current.size >= 2) {
        beginPinch();
      }
      return;
    }
    event.preventDefault();
    beginSinglePointerPan(event.pointerId, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [allowViewportControls, beginPinch, beginSinglePointerPan]);

  const onPointerMove = useCallback((event) => {
    if (!allowViewportControls) return;
    if (event.pointerType === "touch") {
      if (!touchPointsRef.current.has(event.pointerId)) return;
      touchPointsRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touchPointsRef.current.size >= 2) {
        updatePinch();
      } else if (touchPointsRef.current.size === 1) {
        updateSinglePointerPan(event.clientX, event.clientY);
      }
      return;
    }
    if (gestureRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateSinglePointerPan(event.clientX, event.clientY);
  }, [allowViewportControls, updatePinch, updateSinglePointerPan]);

  const onPointerUp = useCallback((event) => {
    if (!allowViewportControls) return;
    if (event.pointerType === "touch") {
      touchPointsRef.current.delete(event.pointerId);
      if (touchPointsRef.current.size >= 2) {
        beginPinch();
      } else if (touchPointsRef.current.size === 1) {
        const [remaining] = Array.from(touchPointsRef.current.entries());
        if (remaining) {
          beginSinglePointerPan(remaining[0], remaining[1].clientX, remaining[1].clientY);
        }
      }
      return;
    }
    if (gestureRef.current.pointerId === event.pointerId) {
      gestureRef.current.pointerId = null;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, [allowViewportControls, beginPinch, beginSinglePointerPan]);

  const onWheel = useCallback((event) => {
    if (!allowViewportControls) return;
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    applyViewportFrame({
      ...viewportFrameRef.current,
      zoom: viewportFrameRef.current.zoom * zoomFactor,
    });
  }, [allowViewportControls, applyViewportFrame]);

  useImperativeHandle(ref, () => ({
    isLive: () => status === "ready" || status === "speaking" || status === "synthesizing" || status === "paused",
    streamChunk: (text) => {
      if (text) pendingTextRef.current += text;
    },
    endMessage: async () => {
      const text = pendingTextRef.current.trim();
      pendingTextRef.current = "";
      onSpeechCaptionChange?.("");
      if (!text || mutedRef.current) return;
      const { language, voiceURI, voiceProfileId, kokoroVoice, supertonicVoice } = readVoiceSettings();
      const speechService = getSpeechService();
      // A newer reply always wins — cancels both any still-playing audio AND
      // (via localAvatarSpeechService's AbortController) any synthesis
      // request still in flight, so an obsolete OpenVoiceClone call can
      // never finish speaking over this one.
      speechService.stop();
      setExpression("reassuring");
      try {
        await speechService.speak(text, {
          language,
          voice: voiceURI,
          voiceProfileId,
          kokoroVoice,
          supertonicVoice,
          onAmplitude: (value) => {
            lipSyncRef.current?.onAmplitude(value);
            const speakingAmount = clamp01(value);
            updateSpeechExpression({
              isSpeaking: speakingAmount > 0.02,
              speakingAmount,
              emphasis: Math.max(speechExpressionRef.current.emphasis * 0.82, speakingAmount),
            });
          },
          onSpokenText: (spokenText) => {
            onSpeechCaptionChange?.(spokenText);
          },
          onExpressionChange: (nextExpression) => {
            setExpression(nextExpression || "reassuring");
          },
          onViseme: (name) => lipSyncRef.current?.onViseme(name),
          // Network-backed providers (OpenVoiceClone) can take a long time
          // to return, especially under CPU/memory pressure — without a
          // distinct status here the avatar just sits idle with no visible
          // sign anything is happening, easy to mistake for broken/stuck.
          onSynthesisStart: () => {
            setStatus("synthesizing");
            setExpression("thinking");
            updateSpeechExpression({
              isSynthesizing: true,
              isSpeaking: false,
              speakingAmount: 0,
              emphasis: 0,
            });
          },
          onPlaybackStart: () => {
            setStatus("speaking");
            setExpression("reassuring");
            updateSpeechExpression({
              isSynthesizing: false,
              isSpeaking: true,
              speakingAmount: 0.16,
              emphasis: 0.16,
            });
          },
        });
      } catch (err) {
        console.error("[Local3DAvatar] speech failed:", err);
      } finally {
        onSpeechCaptionChange?.("");
        const finishedAt = performance.now();
        const settleSpeechFace = () => {
          if ((performance.now() - finishedAt) < SPEECH_ACTIVITY_DECAY_MS) {
            requestAnimationFrame(settleSpeechFace);
            return;
          }
          updateSpeechExpression({
            isSynthesizing: false,
            isSpeaking: false,
            speakingAmount: 0,
            emphasis: 0,
          });
          setExpression("attentive");
        };
        requestAnimationFrame(settleSpeechFace);
        setStatus((s) => (s === "speaking" || s === "synthesizing" ? "ready" : s));
      }
    },
    initialize: async () => {
      // Model load is already kicked off by mounting <AvatarModel/> below —
      // nothing additional to trigger here.
    },
    pause: () => { speechServiceRef.current.pause(); setStatus("paused"); },
    resume: () => { speechServiceRef.current.resume(); setStatus("speaking"); },
    stop: () => {
      speechServiceRef.current.stop();
      pendingTextRef.current = "";
      updateSpeechExpression({
        isSynthesizing: false,
        isSpeaking: false,
        speakingAmount: 0,
        emphasis: 0,
      });
      setExpression("attentive");
      setStatus((s) => (s === "error" || s === "model-not-found" ? s : "ready"));
    },
    setMuted: (muted) => {
      mutedRef.current = Boolean(muted);
      if (mutedRef.current) speechServiceRef.current.stop();
    },
    // Must be called synchronously from a real click/tap — see
    // localAvatarSpeechService.js's own unlockAudio() for why.
    unlockAudio: () => speechServiceRef.current.unlockAudio?.(),
    destroy: () => {
      speechServiceRef.current.stop();
    },
  }), [status, getSpeechService, onSpeechCaptionChange, updateSpeechExpression]);

  return (
    <div
      className="local3d_avatar"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <Canvas camera={{ position: [0, 0, 3], fov: 30 }} dpr={[1, 2]}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[1, 2, 2]} intensity={0.8} />
        <Suspense fallback={null}>
          <ModelErrorBoundary onError={handleModelError} fallback={null}>
            <AvatarModel modelUrl={LOCAL_3D_AVATAR_MODEL_URL} onReady={handleModelReady} />
          </ModelErrorBoundary>
        </Suspense>
        {modelStateRef.current && (
          <>
            <PortraitCamera
              portraitTarget={modelStateRef.current.portraitTarget}
              modelHeight={modelStateRef.current.modelHeight}
              viewportFrameRef={viewportFrameRef}
            />
            <AvatarController
              root={modelStateRef.current.root}
              meshesWithMorphs={modelStateRef.current.meshesWithMorphs}
              standardToReal={modelStateRef.current.standardToReal}
              expression={expression}
              speechExpressionRef={speechExpressionRef}
              postureRef={postureRef}
              onLipSyncReady={handleLipSyncReady}
            />
          </>
        )}
      </Canvas>
      {status !== "ready" && status !== "speaking" && status !== "paused" && status !== "synthesizing" && (
        <div className="local3d_avatar_status">
          {status === "initializing" && "Loading local 3D avatar…"}
          {status === "model-not-found" &&
            `Local 3D avatar model not found — add a rigged .glb at ${LOCAL_3D_AVATAR_MODEL_URL}`}
          {status === "error" && "Local 3D avatar unavailable — text chat still works."}
        </div>
      )}
      {allowViewportControls && frameDirty && (
        <div className="local3d_avatar_frame_actions">
          <button type="button" className="local3d_avatar_frame_btn" onClick={handleSaveViewportFrame}>
            Save
          </button>
          <button type="button" className="local3d_avatar_frame_btn local3d_avatar_frame_btn--ghost" onClick={handleIgnoreViewportFrame}>
            Ignore
          </button>
        </div>
      )}
    </div>
  );
});

Local3DAvatarView.displayName = "Local3DAvatarView";

export default Local3DAvatarView;
export { LOCAL_3D_AVATAR_MODEL_URL };
