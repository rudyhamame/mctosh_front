const DB_NAME = "mctosh-source-background";
const STORE_NAME = "pending";
const PENDING_KEY = "split-pdf";
const PENDING_FILE_NAME = "pending-split-upload.pdf";

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const opfsRoot = async () => {
  if (!navigator.storage?.getDirectory) return null;
  return navigator.storage.getDirectory();
};

const removePersistedFile = async () => {
  const root = await opfsRoot();
  if (!root) return;
  await root.removeEntry(PENDING_FILE_NAME).catch(() => {});
};

const persistFile = async (file, onProgress) => {
  const root = await opfsRoot();
  if (!root) return false;
  await navigator.storage?.persist?.().catch(() => false);
  const handle = await root.getFileHandle(PENDING_FILE_NAME, { create: true });
  const writable = await handle.createWritable();
  const reader = file.stream().getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress?.({ loaded: written, total: file.size, progress: Math.min(100, Math.round((written / file.size) * 100)) });
    }
    await writable.close();
    return written === file.size;
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
};

const putMetadata = async (storedValue) => {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(storedValue, PENDING_KEY);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

export const savePendingSplit = async (value, onProgress) => {
  try {
    const file = value?.file;
    const storedValue = {
      ...value,
      fileName: value?.fileName || file?.name || "source.pdf",
      fileType: value?.fileType || file?.type || "application/pdf",
      fileSize: value?.fileSize || file?.size || 0,
      fileLastModified: value?.fileLastModified || file?.lastModified || Date.now(),
    };
    delete storedValue.file;

    if (storedValue.uploadJobId) {
      await putMetadata(storedValue);
      await removePersistedFile();
      return true;
    }

    if (!(file instanceof Blob) || file.size <= 0) return false;
    const persisted = await persistFile(file, onProgress);
    if (!persisted) return false;
    await putMetadata(storedValue);
    return true;
  } catch (error) {
    console.error("[source split persistence]", error);
    return false;
  }
};

export const loadPendingSplit = async () => {
  try {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PENDING_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!value) return null;
    if (value.uploadJobId) return value;

    // Migrate a legacy IndexedDB File if one still exists; new saves use OPFS.
    let blob = value.file instanceof Blob ? value.file : null;
    if (!blob) {
      const root = await opfsRoot();
      if (!root) return null;
      const handle = await root.getFileHandle(PENDING_FILE_NAME);
      blob = await handle.getFile();
    }
    if (!blob?.size || (value.fileSize && blob.size !== value.fileSize)) return null;
    const file = new File([blob], value.fileName || "source.pdf", {
      type: value.fileType || blob.type || "application/pdf",
      lastModified: value.fileLastModified || blob.lastModified || Date.now(),
    });
    return { ...value, file };
  } catch {
    return null;
  }
};

export const clearPendingSplit = async () => {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(PENDING_KEY);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {}
  await removePersistedFile().catch(() => {});
};
