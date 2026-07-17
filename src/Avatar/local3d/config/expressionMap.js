// Named expression -> blend of STANDARD morph-target names (see
// morphTargetMap.js) and their target weights (0..1). useFacialExpression
// eases toward these weights each frame; AvatarController resolves the
// standard names to whatever the loaded model actually calls them.

export const EXPRESSIONS = {
  neutral: {},
  attentive: {
    browInnerUp: 0.35,
  },
  concerned: {
    browDownLeft: 0.4,
    browDownRight: 0.4,
    mouthFrown: 0.25,
  },
  reassuring: {
    mouthSmile: 0.3,
    browInnerUp: 0.15,
  },
  alert: {
    browInnerUp: 0.6,
    browDownLeft: 0.15,
    browDownRight: 0.15,
  },
  thinking: {
    browDownLeft: 0.25,
    mouthPucker: 0.2,
  },
};

export const DEFAULT_EXPRESSION = "neutral";
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);
