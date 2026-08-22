let activeRequestCount = 0;
const listeners = new Set();

const publish = () => listeners.forEach((listener) => listener());

export const subscribeToGlyphCharActivity = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getGlyphCharActivitySnapshot = () => activeRequestCount;

export const trackGlyphCharActivity = async (request) => {
  activeRequestCount += 1;
  publish();
  try {
    return await request();
  } finally {
    activeRequestCount = Math.max(0, activeRequestCount - 1);
    publish();
  }
};
