export const BBOX_TYPE_DEFINITIONS = Object.freeze({
  bbox: Object.freeze({
    role: "content",
    label: "BBox",
    editable: true,
    showsCard: true,
    extractsText: true,
    autoFitsText: true,
    preventsContact: true,
    bendsAroundObstacles: true,
    canBeNested: true,
  }),
  bboxContainer: Object.freeze({
    role: "container",
    label: "Container BBox",
    editable: true,
    showsCard: false,
    extractsContainerTitle: true,
    preventsContact: true,
    bendsAroundObstacles: true,
    containsChildren: true,
  }),
  bboxTitle: Object.freeze({
    role: "title",
    label: "Title BBox",
    editable: false,
    showsCard: false,
    extractsTitle: true,
    bendsAroundObstacles: false,
  }),
  imageBBox: Object.freeze({
    role: "content",
    label: "Image BBox",
    editable: true,
    showsCard: true,
    extractsText: true,
    capturesImage: true,
    canBeNested: true,
  }),
});

export const BBOX_TYPES = new Set(Object.keys(BBOX_TYPE_DEFINITIONS));
export const EDITABLE_BBOX_TYPES = new Set(
  Object.entries(BBOX_TYPE_DEFINITIONS).filter(([, definition]) => definition.editable).map(([type]) => type),
);
export const BBOX_CARD_TYPES = new Set(
  Object.entries(BBOX_TYPE_DEFINITIONS).filter(([, definition]) => definition.showsCard).map(([type]) => type),
);
export const BBOX_OBSTACLE_TYPES = new Set(
  Object.entries(BBOX_TYPE_DEFINITIONS).filter(([, definition]) => definition.preventsContact).map(([type]) => type),
);

export const getBBoxTypeDefinition = (type) => BBOX_TYPE_DEFINITIONS[type] || null;
export const isBBoxType = (type) => BBOX_TYPES.has(type);
export const bboxTypeHas = (type, capability) => Boolean(BBOX_TYPE_DEFINITIONS[type]?.[capability]);

export const getViewportDocumentSize = (viewport, fallbackWidth = 1, fallbackHeight = 1) => {
  const viewportScale = Math.max(0.0001, Number(viewport?.scale) || 1);
  return {
    width: Math.max(1, (Number(viewport?.width) || fallbackWidth) / viewportScale),
    height: Math.max(1, (Number(viewport?.height) || fallbackHeight) / viewportScale),
  };
};

export const clientPointToBBoxPagePoint = ({
  clientX,
  clientY,
  rect,
  viewport,
  time = 0,
  pressure = 0.5,
}) => {
  const safeRect = rect || { left: 0, top: 0, width: 1, height: 1 };
  const pageSize = getViewportDocumentSize(viewport, safeRect.width, safeRect.height);
  return {
    x: ((clientX - safeRect.left) / Math.max(1, safeRect.width)) * pageSize.width,
    y: ((clientY - safeRect.top) / Math.max(1, safeRect.height)) * pageSize.height,
    vx: clientX,
    vy: clientY,
    t: time,
    pressure: Math.min(1, Math.max(0, pressure || 0.5)),
  };
};

export const createBBoxDraft = (type, point, {
  color,
  lineWidth,
  borderStyle,
} = {}) => {
  if (!isBBoxType(type) || !point) return null;
  return {
    type,
    color,
    closed: false,
    x: point.x,
    y: point.y,
    w: 0,
    h: 0,
    points: [{
      x: point.x,
      y: point.y,
      ...(point.t != null ? { t: point.t } : {}),
      ...(point.pressure != null ? { pressure: point.pressure } : {}),
    }],
    borderStyle,
    shapeBackground: false,
    lineWidth,
  };
};
