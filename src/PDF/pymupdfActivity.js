let activeRequestCount = 0;
const listeners = new Set();

const publish = () => {
  listeners.forEach((listener) => listener());
};

export const subscribeToPyMuPDFActivity = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getPyMuPDFActivitySnapshot = () => activeRequestCount;

export const trackPyMuPDFActivity = async (request) => {
  activeRequestCount += 1;
  publish();
  try {
    return await request();
  } finally {
    activeRequestCount = Math.max(0, activeRequestCount - 1);
    publish();
  }
};
