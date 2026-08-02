const containsBBox = (parent, child, inset = 2) => (
  child.x >= parent.x - inset
  && child.y >= parent.y - inset
  && child.x + child.w <= parent.x + parent.w + inset
  && child.y + child.h <= parent.y + parent.h + inset
);

const smallestContaining = (items, child) => items
  .filter((item) => containsBBox(item, child))
  .sort((left, right) => (left.w * left.h) - (right.w * right.h))[0] || null;

export const normalizePagePartitionHierarchy = (annotations) => {
  const items = Array.isArray(annotations) ? annotations : [];
  const pages = items.filter((item) => item?.type === "pageBBox");
  const partitions = items.filter((item) => item?.type === "columnBBox");
  const partitionPage = new Map(partitions.map((partition) => [
    partition.id,
    smallestContaining(pages, partition),
  ]));

  return items.map((item) => {
    if (item?.type === "columnBBox") {
      const page = partitionPage.get(item.id);
      if (page) return { ...item, parentId: page.id };
      const { parentId: _invalidParentId, ...withoutParent } = item;
      return withoutParent;
    }
    if (!["bbox", "imageBBox"].includes(item?.type)) return item;
    const page = smallestContaining(pages, item);
    if (!page) {
      const { parentId: _invalidParentId, ...withoutParent } = item;
      return withoutParent;
    }
    const partition = smallestContaining(
      partitions.filter((candidate) => partitionPage.get(candidate.id)?.id === page.id),
      item,
    );
    return { ...item, parentId: partition?.id || page.id };
  });
};
