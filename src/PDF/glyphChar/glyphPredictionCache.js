export const createGlyphPredictionCache = () => {
  const entries = new Map();
  let hits = 0;
  let misses = 0;
  return {
    getOrCreate(key, factory) {
      if (entries.has(key)) {
        hits += 1;
        return entries.get(key);
      }
      misses += 1;
      const pending = Promise.resolve().then(factory).catch((error) => {
        entries.delete(key);
        throw error;
      });
      entries.set(key, pending);
      return pending;
    },
    clear() { entries.clear(); hits = 0; misses = 0; },
    diagnostics() { return { definitions: entries.size, hits, misses }; },
  };
};

