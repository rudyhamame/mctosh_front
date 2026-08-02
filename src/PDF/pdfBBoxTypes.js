export const BBOX_TYPE_DEFINITIONS = Object.freeze({
  bbox: Object.freeze({
    role: "content",
    label: "Paragraph BBox",
    editable: true,
    showsCard: true,
    extractsText: true,
    autoFitsText: true,
    canBeNested: true,
  }),
  subLineBBox: Object.freeze({
    role: "text-structure",
    label: "SubLine BBox",
    editable: true,
    showsCard: false,
    extractsText: true,
    autoFitsText: true,
    canBeNested: true,
  }),
  columnBBox: Object.freeze({
    role: "layout",
    label: "Partition BBox",
    editable: true,
    showsCard: false,
    canBeNested: true,
    constrainsSelection: true,
  }),
  pageBBox: Object.freeze({
    role: "page",
    label: "Page BBox",
    editable: true,
    showsCard: false,
    containsChildren: true,
    isPageRoot: true,
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
    label: "Figure BBox",
    editable: true,
    showsCard: true,
    extractsText: true,
    capturesImage: true,
    canBeNested: true,
  }),
});

export const BBOX_TYPES = new Set(Object.keys(BBOX_TYPE_DEFINITIONS));
export const BBOX_TYPE_ABBREVIATIONS = Object.freeze({
  pageBBox: "Pg",
  columnBBox: "Part",
  bbox: "Para",
  subLineBBox: "SubL",
  imageBBox: "Fig",
  bboxTitle: "Tit",
});

export const getBBoxTypeAbbreviation = (type) => BBOX_TYPE_ABBREVIATIONS[type] || "BBox";
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

// Page layout hierarchy is deliberately shallow: optional partitions fence
// regional content, while paragraphs and figures may live either directly on
// the page or in one partition. Semantic sections do not own layout partitions.
export const canBBoxContain = (parentType, childType) => {
  if (parentType === "pageBBox") {
    return ["columnBBox", "bbox", "imageBBox"].includes(childType);
  }
  if (parentType === "columnBBox") return ["bbox", "imageBBox"].includes(childType);
  if (parentType === "bbox") return childType === "subLineBBox";
  return false;
};

const semanticBBoxKind = (type) => ({
  bbox: "paragraph",
  subLineBBox: "subline",
  columnBBox: "partition",
  bboxTitle: "title",
  imageBBox: "figure",
  pageBBox: "page",
}[type] || "bbox");

export const getSemanticHyleBBoxId = (sourceId, pageNum, type, ordinal = 1) => (
  `hyle${String(sourceId || "local")}:p${String(pageNum)};${semanticBBoxKind(type)}-${Math.max(1, Number(ordinal) || 1)}`
);

export const buildHyleBBoxIdMap = (annotations, sourceOrder, pageNum) => {
  const items = Array.isArray(annotations) ? annotations.filter(Boolean) : [];
  const contains = (child, parent) => (
    child.x >= parent.x - 2
    && child.y >= parent.y - 2
    && child.x + child.w <= parent.x + parent.w + 2
    && child.y + child.h <= parent.y + parent.h + 2
  );
  const paragraphs = items.filter((bbox) => bbox.type === "bbox");
  const paragraphOrderById = new Map();
  paragraphs.forEach((paragraph, index) => paragraphOrderById.set(paragraph.id, index + 1));
  const figureOrderById = new Map();
  let figureOrder = 0;
  items.forEach((bbox) => {
    if (bboxTypeHas(bbox.type, "capturesImage")) figureOrderById.set(bbox.id, ++figureOrder);
  });
  const subLineCounts = new Map();
  const ids = {};
  items.forEach((bbox) => {
    const prefix = `hyle${Math.max(1, Number(sourceOrder) || 1)}:p${pageNum}`;
    if (bboxTypeHas(bbox.type, "capturesImage")) {
      ids[bbox.id] = `${prefix};fig${figureOrderById.get(bbox.id) || 1}`;
      return;
    }
    if (bbox.type === "pageBBox") {
      ids[bbox.id] = `${prefix};page`;
      return;
    }
    if (bbox.type === "subLineBBox") {
      const paragraph = paragraphs.find((candidate) => (
        bbox.parentId === candidate.id || contains(bbox, candidate)
      ));
      const paragraphOrder = paragraphOrderById.get(paragraph?.id) || 1;
      const key = paragraph?.id || "standalone";
      const subLineOrder = (subLineCounts.get(key) || 0) + 1;
      subLineCounts.set(key, subLineOrder);
      ids[bbox.id] = `${prefix};ph${paragraphOrder};sl${subLineOrder}`;
      return;
    }
    if (bbox.type === "bbox") {
      ids[bbox.id] = `${prefix};ph${paragraphOrderById.get(bbox.id) || 1}`;
    }
  });
  return ids;
};

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
