import React, { Component, forwardRef, Suspense, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import AvatarModel from "./AvatarModel";
import AvatarController from "./AvatarController";
import { createLocalAvatarSpeechService } from "./services/localAvatarSpeechService";
import { createBrowserTTSProvider } from "./services/ttsProviders/BrowserTTSProvider";
import { createOpenVoiceCloneProvider } from "./services/ttsProviders/OpenVoiceCloneProvider";
import { createKokoroTTSProvider } from "./services/ttsProviders/KokoroTTSProvider";
import { readVoiceSettings, TTS_PROVIDERS, readTtsProviderId } from "./ttsProviderSettings";
import "./local3dAvatarView.css";

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

const createTtsProviderFor = (providerId) => {
  if (providerId === TTS_PROVIDERS.OPENVOICE) return createOpenVoiceCloneProvider();
  if (providerId === TTS_PROVIDERS.KOKORO) return createKokoroTTSProvider();
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
const PortraitCamera = ({ portraitTarget, modelHeight }) => {
  const { camera } = useThree();
  const appliedRef = useRef(false);

  useFrame(() => {
    if (appliedRef.current || !portraitTarget) return;
    appliedRef.current = true;
    // Generous enough that the head-region slice (see AvatarModel.jsx's own
    // HEAD_REGION_FRACTION) sits well inside the circular avatar frame
    // (border-radius:50% crop, see local3dAvatarView.css) with real margin,
    // not edge-to-edge.
    const distance = Math.max(0.6, modelHeight * 0.7);
    camera.position.set(portraitTarget.x, portraitTarget.y, portraitTarget.z + distance);
    camera.lookAt(portraitTarget);
    if (camera.isPerspectiveCamera) camera.updateProjectionMatrix();
  });

  return null;
};

const Local3DAvatarView = forwardRef((_props, ref) => {
  // idle | initializing | ready | speaking | paused | error | model-not-found
  const [status, setStatus] = useState("initializing");
  const [expression, setExpression] = useState("neutral");
  const modelStateRef = useRef(null); // { root, meshesWithMorphs, standardToReal }
  const lipSyncRef = useRef(null);    // { onAmplitude, onViseme } from AvatarController
  const activeTtsProviderIdRef = useRef(readTtsProviderId());
  const speechServiceRef = useRef(createLocalAvatarSpeechService(createTtsProviderFor(activeTtsProviderIdRef.current)));
  const pendingTextRef = useRef("");  // buffered across streamChunk() calls until endMessage() flushes it
  const mutedRef = useRef(false);

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

  useImperativeHandle(ref, () => ({
    isLive: () => status === "ready" || status === "speaking" || status === "synthesizing" || status === "paused",
    streamChunk: (text) => {
      if (text) pendingTextRef.current += text;
    },
    endMessage: async () => {
      const text = pendingTextRef.current.trim();
      pendingTextRef.current = "";
      if (!text || mutedRef.current) return;
      const { language, voiceURI, voiceProfileId } = readVoiceSettings();
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
          onAmplitude: (value) => lipSyncRef.current?.onAmplitude(value),
          onViseme: (name) => lipSyncRef.current?.onViseme(name),
          // Network-backed providers (OpenVoiceClone) can take a long time
          // to return, especially under CPU/memory pressure — without a
          // distinct status here the avatar just sits idle with no visible
          // sign anything is happening, easy to mistake for broken/stuck.
          onSynthesisStart: () => setStatus("synthesizing"),
          onPlaybackStart: () => setStatus("speaking"),
        });
      } catch (err) {
        console.error("[Local3DAvatar] speech failed:", err);
      } finally {
        setStatus((s) => (s === "speaking" || s === "synthesizing" ? "ready" : s));
        setExpression("neutral");
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
      setExpression("neutral");
      setStatus((s) => (s === "error" || s === "model-not-found" ? s : "ready"));
    },
    setMuted: (muted) => {
      mutedRef.current = Boolean(muted);
      if (mutedRef.current) speechServiceRef.current.stop();
    },
    destroy: () => {
      speechServiceRef.current.stop();
    },
  }), [status]);

  return (
    <div className="local3d_avatar">
      <Canvas camera={{ position: [0, 0, 3], fov: 24 }} dpr={[1, 2]}>
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
            />
            <AvatarController
              root={modelStateRef.current.root}
              meshesWithMorphs={modelStateRef.current.meshesWithMorphs}
              standardToReal={modelStateRef.current.standardToReal}
              expression={expression}
              onLipSyncReady={handleLipSyncReady}
            />
          </>
        )}
      </Canvas>
      {status !== "ready" && status !== "speaking" && status !== "paused" && (
        <div className="local3d_avatar_status">
          {status === "initializing" && "Loading local 3D avatar…"}
          {status === "synthesizing" && "Synthesizing voice…"}
          {status === "model-not-found" &&
            `Local 3D avatar model not found — add a rigged .glb at ${LOCAL_3D_AVATAR_MODEL_URL}`}
          {status === "error" && "Local 3D avatar unavailable — text chat still works."}
        </div>
      )}
    </div>
  );
});

Local3DAvatarView.displayName = "Local3DAvatarView";

export default Local3DAvatarView;
export { LOCAL_3D_AVATAR_MODEL_URL };
