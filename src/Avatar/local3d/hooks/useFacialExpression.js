import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { EXPRESSIONS, DEFAULT_EXPRESSION } from "../config/expressionMap";
import { applyMorphWeight } from "../config/morphTargetMap";

// Every standard morph target any expression ever touches — computed once
// so switching expression eases a no-longer-targeted weight back to 0
// instead of leaving it stuck at whatever the previous expression set it to.
const ALL_TOUCHED_TARGETS = Array.from(
  new Set(Object.values(EXPRESSIONS).flatMap((exp) => Object.keys(exp)))
);

const EASE_RATE = 0.08; // per-frame lerp fraction — reaches target in well under a second at 60fps

const buildSpeechOverlay = (speechExpression) => {
  if (!speechExpression) return {};

  const speakingAmount = Math.max(0, Math.min(1, Number(speechExpression.speakingAmount) || 0));
  const emphasis = Math.max(0, Math.min(1, Number(speechExpression.emphasis) || 0));
  const isSynthesizing = Boolean(speechExpression.isSynthesizing);
  const isSpeaking = Boolean(speechExpression.isSpeaking);

  if (isSynthesizing && !isSpeaking) {
    return {
      browInnerUp: 0.22,
      browDownLeft: 0.12,
      browDownRight: 0.12,
      mouthPucker: 0.14,
    };
  }

  if (!isSpeaking && speakingAmount <= 0.001) return {};

  return {
    browInnerUp: 0.08 + speakingAmount * 0.12 + emphasis * 0.08,
    mouthSmile: 0.05 + speakingAmount * 0.16,
    mouthFunnel: speakingAmount * 0.06,
  };
};

const mergeTargetWeights = (baseExpression, speechExpression) => {
  const base = EXPRESSIONS[baseExpression] || EXPRESSIONS[DEFAULT_EXPRESSION];
  const speechOverlay = buildSpeechOverlay(speechExpression);
  if (!Object.keys(speechOverlay).length) return base;

  const merged = { ...base };
  for (const [standardName, weight] of Object.entries(speechOverlay)) {
    merged[standardName] = Math.max(merged[standardName] || 0, weight);
  }
  return merged;
};

export const useFacialExpression = ({ meshesWithMorphs, standardToReal, expression, speechExpressionRef }) => {
  const currentWeights = useRef({});

  useFrame(() => {
    const target = mergeTargetWeights(expression, speechExpressionRef?.current);
    for (const standardName of ALL_TOUCHED_TARGETS) {
      const targetWeight = target[standardName] || 0;
      const prevWeight = currentWeights.current[standardName] || 0;
      const nextWeight = prevWeight + (targetWeight - prevWeight) * EASE_RATE;
      currentWeights.current[standardName] = nextWeight;
      applyMorphWeight(meshesWithMorphs, standardToReal, standardName, nextWeight);
    }
  });
};

export default useFacialExpression;
