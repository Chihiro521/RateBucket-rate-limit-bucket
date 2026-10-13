function key(node: Node): string | null {
  return node instanceof Element ? node.getAttribute("data-node-key") : null;
}

function compatible(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && (!(a instanceof Element) ||
    b instanceof Element && a.tagName === b.tagName && key(a) === key(b));
}

// Reuse live nodes (and their listeners/pointer capture) instead of replacing roots.
export function reconcileChildren(parent: Node, desired: Node[]): void {
  const old = Array.from(parent.childNodes);
  const claimed = new Set<Node>();
  let cursor = parent.firstChild;
  for (const next of desired) {
    const nodeKey = key(next);
    const previous = nodeKey !== null
      ? old.find((node) => !claimed.has(node) && key(node) === nodeKey && compatible(node, next))
      : cursor && !claimed.has(cursor) && compatible(cursor, next) ? cursor : undefined;
    const node = previous ?? next;
    claimed.add(node);
    if (previous) patch(previous, next);
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  for (const node of old) if (!claimed.has(node) && node.parentNode === parent) parent.removeChild(node);
}

function patch(current: Node, next: Node): void {
  if (!(current instanceof Element) || !(next instanceof Element)) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attr of Array.from(current.attributes)) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of Array.from(next.attributes)) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  const selected = next instanceof HTMLSelectElement ? next.value : undefined;
  reconcileChildren(current, Array.from(next.childNodes));
  if (current instanceof HTMLSelectElement && selected !== undefined) current.value = selected;
}
