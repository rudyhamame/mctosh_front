export const flattenRawJson = (value, rootPath = "response") => {
  const rows = [];
  const visit = (node, path) => {
    if (node === null) {
      rows.push({ path, type: "null", value: null });
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) rows.push({ path, type: "array", value: [] });
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (typeof node === "object") {
      const entries = Object.entries(node);
      if (entries.length === 0) rows.push({ path, type: "object", value: {} });
      entries.forEach(([key, item]) => visit(item, `${path}.${key}`));
      return;
    }
    rows.push({ path, type: typeof node, value: node });
  };
  visit(value, rootPath);
  return rows;
};
