export const PATINA_VERSION = 1;
const GRID_COLUMNS = 8;
const GRID_ROWS = 12;
const MAX_MARKS = 96;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const pageKey = (page) => String(Math.max(1, Number(page) || 1));

export const emptyPagePatina = () => ({
  openCount: 0,
  turnCount: 0,
  drawCount: 0,
  highlightCount: 0,
  eraseCount: 0,
  antiAgeCount: 0,
  contactCount: 0,
  annotationDensity: 0,
  edgeWear: 0,
  cornerWear: 0,
  interactionHeatmap: Array(GRID_COLUMNS * GRID_ROWS).fill(0),
  abrasionMap: [],
  smudgeMap: [],
  creaseMap: [],
});

export const emptyPatinaState = () => ({ version: PATINA_VERSION, pages: {} });

const normalizePage = (raw) => {
  const page = { ...emptyPagePatina(), ...(raw && typeof raw === "object" ? raw : {}) };
  page.interactionHeatmap = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => clamp01(page.interactionHeatmap?.[index]));
  ["abrasionMap", "smudgeMap", "creaseMap"].forEach((key) => {
    page[key] = Array.isArray(page[key]) ? page[key].slice(-MAX_MARKS).map((mark) => ({
      x: clamp01(mark.x), y: clamp01(mark.y), strength: clamp01(mark.strength), radius: clamp01(mark.radius),
    })) : [];
  });
  return page;
};

export const normalizePatinaState = (raw) => {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    version: PATINA_VERSION,
    pages: Object.fromEntries(Object.entries(state.pages || {}).map(([page, value]) => [pageKey(page), normalizePage(value)])),
  };
};

const addMark = (marks, point, strength, radius) => ([
  ...marks,
  { x: clamp01(point?.x), y: clamp01(point?.y), strength: clamp01(strength), radius: clamp01(radius) },
].slice(-MAX_MARKS));

export const updatePagePatina = (state, pageNumber, action, point = null, amount = 1) => {
  const key = pageKey(pageNumber);
  const current = normalizePage(state?.pages?.[key]);
  const intensity = clamp01(amount);
  const next = { ...current };
  if (action === "open") next.openCount += 1;
  if (action === "turn") next.turnCount += 1;
  if (action === "draw") {
    next.drawCount += 1;
    next.annotationDensity += 0.012;
  }
  if (action === "highlight") {
    next.highlightCount += 1;
    next.annotationDensity += 0.018;
  }
  if (action === "erase") {
    next.eraseCount += 1;
    next.annotationDensity += 0.01;
  }
  if (action === "antiAge") next.antiAgeCount += 1;
  if (action === "contact") next.contactCount += 1;
  if (action === "turn") {
    next.edgeWear = clamp01(next.edgeWear + 0.012);
    next.cornerWear = clamp01(next.cornerWear + 0.009);
  }
  if (point) {
    const x = clamp01(point.x);
    const y = clamp01(point.y);
    const column = Math.min(GRID_COLUMNS - 1, Math.floor(x * GRID_COLUMNS));
    const row = Math.min(GRID_ROWS - 1, Math.floor(y * GRID_ROWS));
    const heatmap = [...next.interactionHeatmap];
    heatmap[row * GRID_COLUMNS + column] = clamp01(heatmap[row * GRID_COLUMNS + column] + 0.045 * intensity);
    next.interactionHeatmap = heatmap;
    if (action === "antiAge") {
      next.interactionHeatmap = heatmap.map((value, index) => {
        const cellX = (index % GRID_COLUMNS + 0.5) / GRID_COLUMNS;
        const cellY = (Math.floor(index / GRID_COLUMNS) + 0.5) / GRID_ROWS;
        return Math.hypot(cellX - x, cellY - y) < 0.12 ? clamp01(value - 0.16 * intensity) : value;
      });
      const radius = 0.12;
      next.abrasionMap = next.abrasionMap.filter((mark) => Math.hypot(mark.x - x, mark.y - y) > radius);
      next.smudgeMap = next.smudgeMap.filter((mark) => Math.hypot(mark.x - x, mark.y - y) > radius);
      if (x < 0.12 || x > 0.88) next.edgeWear = clamp01(next.edgeWear - 0.025 * intensity);
      if ((x < 0.14 || x > 0.86) && (y < 0.14 || y > 0.86)) next.cornerWear = clamp01(next.cornerWear - 0.02 * intensity);
    }
    if (action === "erase") next.abrasionMap = addMark(next.abrasionMap, point, 0.22 * intensity, 0.035 + 0.025 * intensity);
    if (action === "draw" || action === "highlight") next.smudgeMap = addMark(next.smudgeMap, point, 0.065 * intensity, 0.02 + 0.018 * intensity);
    if (action === "contact") next.smudgeMap = addMark(next.smudgeMap, point, 0.028 * intensity, 0.014);
  }
  return { ...state, version: PATINA_VERSION, pages: { ...(state?.pages || {}), [key]: next } };
};

export const getPagePatina = (state, pageNumber) => normalizePage(state?.pages?.[pageKey(pageNumber)]);

export const patinaStorageKey = (documentKey) => `mctosh_pdf_page_patina:${documentKey || "local"}`;

export const drawPagePatina = (canvas, page, width, height, requestedRatio = window.devicePixelRatio || 1) => {
  if (!canvas || !page || !width || !height) return;
  const use = Math.max(0, page.openCount * 0.002 + page.turnCount * 0.0035 + page.contactCount * 0.0005 + page.annotationDensity * 0.06 - page.antiAgeCount * 0.0015);
  const hasVisiblePatina = use > 0
    || page.edgeWear > 0
    || page.cornerWear > 0
    || page.interactionHeatmap.some((value) => value > 0.01)
    || page.smudgeMap.length > 0
    || page.abrasionMap.length > 0;
  if (!hasVisiblePatina) {
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
    return;
  }
  const ratio = Math.max(0.1, Number(requestedRatio) || 1);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.removeProperty("width");
  canvas.style.removeProperty("height");
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (use > 0) {
    ctx.fillStyle = `rgba(167, 132, 78, ${Math.min(0.07, use)})`;
    ctx.fillRect(0, 0, width, height);
  }
  page.interactionHeatmap.forEach((value, index) => {
    if (value <= 0.01) return;
    const x = (index % GRID_COLUMNS + 0.5) / GRID_COLUMNS * width;
    const y = (Math.floor(index / GRID_COLUMNS) + 0.5) / GRID_ROWS * height;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.min(width / GRID_COLUMNS, height / GRID_ROWS) * 1.8);
    gradient.addColorStop(0, `rgba(125, 93, 48, ${value * 0.07})`);
    gradient.addColorStop(1, "rgba(125, 93, 48, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - width / GRID_COLUMNS * 2, y - height / GRID_ROWS * 2, width / GRID_COLUMNS * 4, height / GRID_ROWS * 4);
  });
  const marks = [...page.smudgeMap, ...page.abrasionMap];
  marks.forEach((mark, index) => {
    const x = mark.x * width;
    const y = mark.y * height;
    const radius = Math.max(2, mark.radius * Math.min(width, height));
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = mark.strength * (page.abrasionMap.includes(mark) ? 0.22 : 0.09);
    gradient.addColorStop(0, `rgba(119, 91, 52, ${alpha})`);
    gradient.addColorStop(1, "rgba(119, 91, 52, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x + (index % 3 - 1) * 0.7, y, radius, radius * 0.55, index * 0.37, 0, Math.PI * 2);
    ctx.fill();
  });
  const edge = Math.min(0.13, page.edgeWear * 0.28);
  if (edge > 0) {
    const edgeGradient = ctx.createLinearGradient(width, 0, 0, 0);
    edgeGradient.addColorStop(0, `rgba(104, 74, 36, ${edge})`);
    edgeGradient.addColorStop(0.08, "rgba(104, 74, 36, 0)");
    ctx.fillStyle = edgeGradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (page.cornerWear > 0) {
    const cornerColor = `rgba(105, 74, 35, ${Math.min(0.09, page.cornerWear * 0.2)})`;
    [[0, 0], [width, 0], [0, height], [width, height]].forEach(([x, y]) => {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.min(width, height) * 0.14);
      gradient.addColorStop(0, cornerColor);
      gradient.addColorStop(1, "rgba(105, 74, 35, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x ? x - width * 0.18 : 0, y ? y - height * 0.18 : 0, width * 0.18, height * 0.18);
    });
  }
};
