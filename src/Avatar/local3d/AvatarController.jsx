import { useEffect } from "react";
import { useBlinking } from "./hooks/useBlinking";
import { useIdleAnimation } from "./hooks/useIdleAnimation";
import { useEyeMovement } from "./hooks/useEyeMovement";
import { useFacialExpression } from "./hooks/useFacialExpression";
import { useLipSync } from "./hooks/useLipSync";

// Runs every animation hook against the same resolved model — mounted only
// once AvatarModel has actually loaded and reported its morph-target map
// (see Local3DAvatarView.jsx). Renders nothing itself; it's a child of
// <Canvas> purely so its hooks can use useFrame. onLipSyncReady hands the
// {onAmplitude, onViseme} pair up so Local3DAvatarView can wire them into
// localAvatarSpeechService.speak() calls.
const AvatarController = ({ root, meshesWithMorphs, standardToReal, expression, onLipSyncReady }) => {
  useBlinking({ meshesWithMorphs, standardToReal, enabled: true });
  useIdleAnimation({ root, enabled: true });
  useEyeMovement({ root, enabled: true });
  useFacialExpression({ meshesWithMorphs, standardToReal, expression });
  const lipSync = useLipSync({ meshesWithMorphs, standardToReal });

  useEffect(() => {
    onLipSyncReady?.(lipSync);
  }, [lipSync, onLipSyncReady]);

  return null;
};

export default AvatarController;
