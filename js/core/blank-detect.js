/**
 * Blank page detection for both born-digital and scanned PDFs.
 *
 *  1. Digital text: if PDF.js finds real (non-whitespace) text on the page, it
 *     is not blank — no rendering needed.
 *  2. Ink analysis: otherwise the page is rendered small (~50 DPI, grayscale)
 *     and checked for "ink":
 *       • a margin band is ignored (scanner edge shadows, punch holes, staples);
 *       • the paper colour is measured (so grey/yellowish/dark scans still work);
 *       • only pixels clearly darker than the paper count as ink, so faint
 *         show-through from the back of the sheet is ignored;
 *       • ink is counted per small cell and a cell only counts if it holds
 *         several ink pixels, so dust and scanner speckles are ignored.
 *       • the paper colour is measured locally, so scanner haze, dark vignettes
 *         and an open-lid dark band are not mistaken for content.
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

const BLOCK = 12;            // px — size of the patches used to measure the local paper colour

/**
 * Share of inked cells (0..1) on a rendered canvas.
 *
 * The paper colour is measured locally (per 12 px patch, blended smoothly
 * between patches), not once for the whole page. Scanner haze, dark
 * vignettes, cloudy grey patches and the dark band from an open scanner lid
 * change slowly across the page, so they match their local paper colour and
 * are ignored; real ink is a sharp dark mark against the paper right next to it.
 * The contrast needed scales with the paper brightness, so text on a dark,
 * grey scan is still found.
 */
export function inkCoverage(canvas, preset) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const x0 = Math.floor(W * MARGIN);
  const y0 = Math.floor(H * MARGIN);
  const w = W - 2 * x0;
  const hgt = H - 2 * y0;
  if (w < BLOCK || hgt < BLOCK) return 0;
  const { data } = ctx.getImageData(x0, y0, w, hgt);

  const lum = new Uint8Array(w * hgt);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
    lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
  }

  // 1. Paper colour per block = its 90th-percentile brightness.
  const bx = Math.ceil(w / BLOCK);
  const by = Math.ceil(hgt / BLOCK);
  const blockBg = new Uint8Array(bx * by);
  const hist = new Uint32Array(256);
  for (let r = 0; r < by; r++) {
    for (let c = 0; c < bx; c++) {
      hist.fill(0);
      let n = 0;
      const yEnd = Math.min(hgt, (r + 1) * BLOCK);
      const xEnd = Math.min(w, (c + 1) * BLOCK);
      for (let y = r * BLOCK; y < yEnd; y++) {
        for (let x = c * BLOCK; x < xEnd; x++) { hist[lum[y * w + x]]++; n++; }
      }
      let acc = 0;
      let v = 255;
      for (; v > 0; v--) { acc += hist[v]; if (acc >= n * 0.1) break; }
      blockBg[r * bx + c] = v;
    }
  }
  // 2. Smooth paper map: blend the block values between block centres (bilinear),
  //    so slow haze is followed closely, then derive the ink threshold per pixel:
  //    `contrast` on white paper, proportionally less on darker paper.
  const limit = new Int16Array(w * hgt);
  for (let y = 0; y < hgt; y++) {
    const fy = Math.min(by - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5));
    const r0 = fy | 0;
    const r1 = Math.min(by - 1, r0 + 1);
    const ty = fy - r0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bx - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5));
      const c0 = fx | 0;
      const c1 = Math.min(bx - 1, c0 + 1);
      const tx = fx - c0;
      const top = blockBg[r0 * bx + c0] * (1 - tx) + blockBg[r0 * bx + c1] * tx;
      const bottom = blockBg[r1 * bx + c0] * (1 - tx) + blockBg[r1 * bx + c1] * tx;
      const paper = top * (1 - ty) + bottom * ty;
      limit[y * w + x] = paper - Math.max(18, preset.contrast * Math.min(1, paper / 235));
    }
  }

  // 4. Count cells that hold enough ink pixels (ignores isolated specks).
  const cols = Math.floor(w / CELL);
  const rows = Math.floor(hgt / CELL);
  let inked = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let dark = 0;
      for (let y = r * CELL; y < (r + 1) * CELL; y++) {
        const row = y * w;
        for (let x = c * CELL; x < (c + 1) * CELL; x++) if (lum[row + x] < limit[row + x]) dark++;
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
