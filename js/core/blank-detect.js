/**
 * Blank page detection for both born-digital and scanned PDFs.
 *
 *  1. Digital text: if PDF.js finds real (non-whitespace) text on the page, it
 *     is not blank — no rendering needed.
 *  2. Ink analysis: otherwise the page is rendered small (~50 DPI, grayscale)
 *     and checked for "ink":
 *       • a margin band is ignored (scanner edge shadows, punch holes, staples);
 *       • the paper colour is measured (so grey/yellowish scans still work);
 *       • only pixels clearly darker than the paper count as ink, so faint
 *         show-through from the back of the sheet is ignored;
 *       • ink is counted per small cell and a cell only counts if it holds
 *         several ink pixels, so dust and scanner speckles are ignored.
 *     A page is blank when the share of inked cells is below the threshold.
 */
import { renderPageToCanvas } from './render.js';
import { releaseCanvas, yieldToUI, throwIfAborted } from './utils.js';

/** Sensitivity presets. `contrast`: how much darker than paper counts as ink (0–255). */
export const BLANK_SENSITIVITY = {
  strict: { label: 'Strict — only completely empty pages', contrast: 50, cellInk: 2, maxCoverage: 0.00005 },
  normal: { label: 'Normal (recommended)', contrast: 70, cellInk: 3, maxCoverage: 0.0004 },
  lenient: { label: 'Lenient — also ignore small stray marks', contrast: 80, cellInk: 4, maxCoverage: 0.0007 },
};

const RENDER_WIDTH = 500;   // px (~60 DPI) — enough to see thin pen strokes and 8 pt text
const MARGIN = 0.08;        // ignore 8 % at each edge (scanner shadows, punch holes, staples)
const CELL = 6;             // px

/** Count real text characters on a PDF.js page. */
async function textCharCount(page) {
  try {
    const content = await page.getTextContent();
    let n = 0;
    for (const item of content.items) if (typeof item.str === 'string') n += item.str.replace(/\s+/g, '').length;
    return n;
  } catch {
    return 0;
  }
}

/** Share of inked cells (0..1) on a rendered canvas. */
export function inkCoverage(canvas, preset) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const x0 = Math.floor(W * MARGIN);
  const y0 = Math.floor(H * MARGIN);
  const w = W - 2 * x0;
  const hgt = H - 2 * y0;
  if (w < CELL || hgt < CELL) return 0;
  const { data } = ctx.getImageData(x0, y0, w, hgt);

  // Luminance + histogram to find the paper colour (bright 90th percentile).
  const lum = new Uint8Array(w * hgt);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    lum[j] = l;
    hist[l]++;
  }
  let acc = 0;
  let paper = 255;
  const target = lum.length * 0.1;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= target) { paper = v; break; } }
  const limit = paper - preset.contrast;
  if (limit <= 0) return 1; // essentially a dark page

  const cols = Math.floor(w / CELL);
  const rows = Math.floor(hgt / CELL);
  let inked = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let dark = 0;
      for (let y = r * CELL; y < (r + 1) * CELL; y++) {
        const row = y * w;
        for (let x = c * CELL; x < (c + 1) * CELL; x++) if (lum[row + x] < limit) dark++;
      }
      if (dark >= preset.cellInk) inked++;
    }
  }
  return inked / (cols * rows);
}

/**
 * Detect blank pages.
 * @param {any} pdfjsDoc PDF.js document
 * @param {{sensitivity?: keyof BLANK_SENSITIVITY, pages?: number[], signal?: AbortSignal, onProgress?: (fraction:number, pageNumber:number) => void, isCancelled?: () => boolean}} [opts]
 * @returns {Promise<{blank: number[], details: {index:number, reason:string, coverage?:number}[]}>} 0-based indexes
 */
export async function detectBlankPages(pdfjsDoc, { sensitivity = 'normal', pages, signal, onProgress, isCancelled } = {}) {
  const preset = BLANK_SENSITIVITY[sensitivity] || BLANK_SENSITIVITY.normal;
  const list = pages || Array.from({ length: pdfjsDoc.numPages }, (_, i) => i);
  const blank = [];
  const details = [];
  for (let k = 0; k < list.length; k++) {
    throwIfAborted(signal);
    if (isCancelled?.()) break;
    const index = list[k];
    onProgress?.(k / list.length, index + 1);
    const page = await pdfjsDoc.getPage(index + 1);
    const chars = await textCharCount(page);
    page.cleanup();
    if (chars > 0) {
      details.push({ index, reason: 'text' });
    } else {
      const { canvas } = await renderPageToCanvas(pdfjsDoc, index + 1, { width: RENDER_WIDTH });
      let coverage;
      try { coverage = inkCoverage(canvas, preset); } finally { releaseCanvas(canvas); }
      const isBlank = coverage <= preset.maxCoverage;
      details.push({ index, reason: isBlank ? 'blank' : 'ink', coverage });
      if (isBlank) blank.push(index);
    }
    if (k % 4 === 3) await yieldToUI();
  }
  onProgress?.(1);
  return { blank, details };
}
