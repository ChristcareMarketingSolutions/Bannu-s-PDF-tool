/**
 * Inline SVG icon set (24×24, stroke based). Built with DOM APIs — no innerHTML.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const P = (d) => ['path', { d }];
const ICONS = {
  // Brand / generic
  logo: [P('M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z'), P('M14 2v5h5'), P('M9 13h6'), P('M9 17h4')],
  file: [P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'), P('M14 2v6h6')],
  // Tools
  merge: [P('M8 3H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2'), P('M16 3h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2'), P('M12 13v8'), P('m9 18 3 3 3-3'), P('M8 8h8')],
  split: [['circle', { cx: 6, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], P('M20 4 8.12 15.88'), P('M14.47 14.48 20 20'), P('M8.12 8.12 12 12')],
  extract: [P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7'), P('M14 2v6h6v5'), P('M16 19h6'), P('m19 16 3 3-3 3')],
  trash: [P('M3 6h18'), P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'), P('M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'), P('M10 11v6'), P('M14 11v6')],
  reorder: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }], P('M14 6.5h3.5a2 2 0 0 1 2 2V11'), P('m17 9 2.5 2.5L22 9'), P('M10 17.5H6.5a2 2 0 0 1-2-2V13'), P('m7 15-2.5-2.5L2 15')],
  rotate: [P('M21 12a9 9 0 1 1-3-6.7L21 8'), P('M21 3v5h-5')],
  rotateLeft: [P('M3 12a9 9 0 1 0 3-6.7L3 8'), P('M3 3v5h5')],
  image: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], ['circle', { cx: 9, cy: 9, r: 2 }], P('m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21')],
  images: [P('M18 22H4a2 2 0 0 1-2-2V6'), ['rect', { x: 6, y: 2, width: 16, height: 16, rx: 2 }], ['circle', { cx: 12, cy: 8, r: 2 }], P('m22 13-2.6-2.6a2 2 0 0 0-2.8 0L10 17')],
  compress: [P('M4 14h6v6'), P('M20 10h-6V4'), P('m14 10 7-7'), P('m3 21 7-7')],
  watermark: [P('M12 2.7 6.3 9a7.5 7.5 0 1 0 11.4 0z')],
  hash: [P('M4 9h16'), P('M4 15h16'), P('M10 3 8 21'), P('M16 3l-2 18')],
  lock: [['rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }], P('M8 11V7a4 4 0 0 1 8 0v4')],
  unlock: [['rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }], P('M8 11V7a4 4 0 0 1 7.9-1')],
  // UI
  upload: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('m17 8-5-5-5 5'), P('M12 3v12')],
  download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('m7 10 5 5 5-5'), P('M12 15V3')],
  x: [P('M18 6 6 18'), P('m6 6 12 12')],
  check: [P('M20 6 9 17l-5-5')],
  checkCircle: [['circle', { cx: 12, cy: 12, r: 10 }], P('m8.5 12.5 2.5 2.5 5-5.5')],
  alert: [['circle', { cx: 12, cy: 12, r: 10 }], P('M12 8v4'), P('M12 16h.01')],
  info: [['circle', { cx: 12, cy: 12, r: 10 }], P('M12 16v-4'), P('M12 8h.01')],
  grip: [['circle', { cx: 9, cy: 6, r: 1 }], ['circle', { cx: 15, cy: 6, r: 1 }], ['circle', { cx: 9, cy: 12, r: 1 }], ['circle', { cx: 15, cy: 12, r: 1 }], ['circle', { cx: 9, cy: 18, r: 1 }], ['circle', { cx: 15, cy: 18, r: 1 }]],
  arrowLeft: [P('M19 12H5'), P('m12 19-7-7 7-7')],
  chevronLeft: [P('m15 18-6-6 6-6')],
  chevronRight: [P('m9 18 6-6-6-6')],
  chevronUp: [P('m18 15-6-6-6 6')],
  chevronDown: [P('m6 9 6 6 6-6')],
  zoomIn: [['circle', { cx: 11, cy: 11, r: 8 }], P('m21 21-4.3-4.3'), P('M11 8v6'), P('M8 11h6')],
  zoomOut: [['circle', { cx: 11, cy: 11, r: 8 }], P('m21 21-4.3-4.3'), P('M8 11h6')],
  search: [['circle', { cx: 11, cy: 11, r: 8 }], P('m21 21-4.3-4.3')],
  plus: [P('M12 5v14'), P('M5 12h14')],
  eye: [P('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12'), ['circle', { cx: 12, cy: 12, r: 3 }]],
  grid: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }]],
  page: [['rect', { x: 5, y: 2, width: 14, height: 20, rx: 2 }], P('M9 7h6'), P('M9 11h6'), P('M9 15h4')],
  refresh: [P('M3 12a9 9 0 0 1 15-6.7L21 8'), P('M21 3v5h-5'), P('M21 12a9 9 0 0 1-15 6.7L3 16'), P('M8 16H3v5')],
  swap: [P('m3 16 4 4 4-4'), P('M7 20V4'), P('m21 8-4-4-4 4'), P('M17 4v16')],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], P('M12 2v2'), P('M12 20v2'), P('m4.9 4.9 1.4 1.4'), P('m17.7 17.7 1.4 1.4'), P('M2 12h2'), P('M20 12h2'), P('m6.3 17.7-1.4 1.4'), P('m19.1 4.9-1.4 1.4')],
  moon: [P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z')],
  shield: [P('M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z'), P('m9 12 2 2 4-4')],
  zap: [P('M13 2 3 14h9l-1 8 10-12h-9z')],
  wifiOff: [P('M12 20h.01'), P('M8.5 16.4a5 5 0 0 1 7 0'), P('M5 12.9a10 10 0 0 1 5.2-2.8'), P('M19 12.9a10 10 0 0 0-2.1-1.6'), P('M2 8.8a15 15 0 0 1 4.2-2.6'), P('M22 8.8A15 15 0 0 0 11 4.9'), P('m2 2 20 20')],
};

/**
 * Create an <svg> icon element.
 * @param {keyof ICONS} name
 * @param {{size?: number, class?: string, label?: string}} [opts]
 */
export function icon(name, opts = {}) {
  const { size = 20, label } = opts;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', opts.strokeWidth ?? '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon ${opts.class || ''}`.trim());
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const [tag, attrs] of ICONS[name] || ICONS.file) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.appendChild(node);
  }
  return svg;
}

/** Hydrate static markup: <span data-icon="lock"></span> → inline SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.firstChild) return;
    el.appendChild(icon(el.dataset.icon, { size: Number(el.dataset.size) || 20 }));
  });
}
