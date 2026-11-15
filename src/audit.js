const scrollable = new Set(['auto', 'scroll', 'hidden', 'overlay']);

function physicalAxis(axis, writingMode) {
  const vertical = /^(vertical|sideways)-/u.test(writingMode);
  if (axis === 'block') return vertical ? 'x' : 'y';
  if (axis === 'inline') return vertical ? 'y' : 'x';
  return axis;
}

function overflow(style) {
  return { x: style.overflowX, y: style.overflowY };
}

function disableBodyPropagation(style) {
  return style.contain !== 'none' || ['auto', 'hidden'].includes(style.contentVisibility);
}

function extent(node, axis) {
  const size = axis === 'x' ? 'Width' : 'Height';
  return Math.max(0, node[`scroll${size}`] - node[`client${size}`]);
}

function label(element) {
  return element.localName + (element.id ? '#' + element.id : '');
}

/**
 * Report the nearest overflow candidate in a standards-mode HTML layout.
 * The selected axis is logical by default and uses the source's writing mode.
 */
export function auditScrollport(element, { axis = 'block' } = {}) {
  if (!['block', 'inline', 'x', 'y'].includes(axis)) throw new TypeError('Choose block, inline, x, or y.');
  const doc = element?.ownerDocument;
  const view = doc?.defaultView;
  if (!view || !(element instanceof view.HTMLElement) || element.getRootNode() !== doc ||
      doc.compatMode !== 'CSS1Compat' || element === doc.body || element === doc.documentElement) {
    throw new TypeError('Select a connected light-DOM HTML element inside a standards-mode document.');
  }
  if (!element.getClientRects().length) throw new Error('The selected element has no rendered layout box.');

  const html = doc.documentElement;
  const body = doc.body;
  const computed = node => view.getComputedStyle(node);
  const htmlStyle = computed(html);
  const bodyStyle = body ? computed(body) : null;
  const htmlOverflow = overflow(htmlStyle);
  const bodyCanPropagate = body?.parentElement === html &&
    !disableBodyPropagation(htmlStyle) && !disableBodyPropagation(bodyStyle);
  const bodyPropagates = bodyCanPropagate && bodyStyle.display !== 'none' &&
    htmlOverflow.x === 'visible' && htmlOverflow.y === 'visible';
  const rootOverflow = bodyPropagates ? overflow(bodyStyle) : htmlOverflow;
  const viewportOverflow = Object.fromEntries(Object.entries(rootOverflow).map(([key, value]) => [
    key, value === 'visible' ? 'auto' : value === 'clip' ? 'hidden' : value,
  ]));

  const ancestors = [];
  let source = null;
  for (let node = element.parentElement; node && node !== html; node = node.parentElement) {
    if (ancestors.length === 200) throw new Error('Ancestor chain exceeds 200 elements.');
    const style = computed(node);
    const values = overflow(style);
    const physical = physicalAxis(axis, style.writingMode);
    let kind = 'pass-through';
    if (node === body && bodyPropagates) kind = 'viewport-propagation';
    else if (['contents', 'inline', 'none'].includes(style.display)) kind = 'no-overflow-box';
    else if (scrollable.has(values.x) || scrollable.has(values.y)) kind = 'scroll-container';
    else if (values.x === 'clip' || values.y === 'clip') kind = 'clip';
    const row = { label: label(node), overflow: values, display: style.display,
      writingMode: style.writingMode, axis: physical,
      range: kind === 'scroll-container' ? extent(node, physical) : null, kind };
    if (!source && kind === 'scroll-container') source = { ...row, index: ancestors.length };
    ancestors.push(row);
  }

  const viewportWritingMode = bodyCanPropagate ? bodyStyle.writingMode : htmlStyle.writingMode;
  const viewportAxis = physicalAxis(axis, viewportWritingMode);
  const viewport = { label: 'Viewport', overflow: viewportOverflow, writingMode: viewportWritingMode,
    axis: viewportAxis, range: extent(doc.scrollingElement ?? html, viewportAxis),
    kind: 'viewport', index: ancestors.length, overflowFrom: bodyPropagates ? 'body' : 'html' };
  ancestors.push(viewport);
  source ??= viewport;

  const style = computed(element);
  const edges = source.axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
  const insets = Object.fromEntries(edges.map(edge => [edge, style[edge]]));
  const target = { label: label(element), position: style.position, insets };
  const warnings = [];
  if (!source.range) warnings.push('no-scroll-range');
  if (source.overflow[source.axis] === 'hidden') warnings.push('programmatic-scroll-only');
  if (style.position === 'sticky' && edges.every(edge => insets[edge] === 'auto')) {
    warnings.push('sticky-insets-auto');
  }
  return { version: 1, requestedAxis: axis, target, source, ancestors, warnings };
}
