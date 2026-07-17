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

export const useFacialExpression = ({ meshesWithMorphs, standardToReal, expression }) => {
  const currentWeights = useRef({});

  useFrame(() => {
    const target = EXPRESSIONS[expression] || EXPRESSIONS[DEFAULT_EXPRESSION];
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
