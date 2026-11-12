/**
 * OCR engine: Tesseract.js recognition + an invisible text layer written with
 * pdf-lib, so scanned PDFs become searchable and copyable while the pages
 * look exactly as before (the original page content is never re-encoded).
 */
import { loadPdfLib, loadTesseract, tesseractPaths } from './libs.js';
import { visualGeometry } from './pdf-tools.js';
import { AppError } from './errors.js';

/** Languages shipped in lib/tesseract/lang (add `<code>.traineddata.gz` there + an entry here). */
export const OCR_LANGUAGES = [
  { value: 'eng', label: 'English' },
];

/**
 * Start a Tesseract worker. Terminates itself when `signal` aborts.
 * @param {{lang?: string, signal?: AbortSignal}} opts
 */
export async function createOcrEngine({ lang = 'eng', signal } = {}) {
  const Tesseract = await loadTesseract();
  let listener = null;
  let worker;
  try {
    worker = await Tesseract.createWorker(lang, Tesseract.OEM?.LSTM_ONLY ?? 1, {
      ...tesseractPaths(),
      logger: (m) => listener?.(m),
      errorHandler: () => {},
    });
  } catch (err) {
    console.error('[ocr] worker start failed', err);
    throw new AppError('The OCR engine could not start. Please reload the page and try again.', 'lib');
  }
  const onAbort = () => worker.terminate().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });

  return {
    /**
     * Recognise one rendered page.
     * @param {HTMLCanvasElement} canvas
     * @returns {Promise<{text: string, lines: {words: {text:string, x0:number, x1:number, baseline:number}[], size:number}[], confidence: number}>}
     */
    async recognize(canvas, onPageProgress) {
      listener = (m) => {
        if (m.status === 'recognizing text') onPageProgress?.(m.progress || 0);
      };
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      listener = null;
      return { text: (data.text || '').trim(), lines: extractLines(data), confidence: data.confidence || 0 };
    },
    async terminate() {
      signal?.removeEventListener('abort', onAbort);
      await worker.terminate().catch(() => {});
    },
  };
}

/** Flatten Tesseract blocks → lines of positioned words (image pixel units, top-left origin). */
function extractLines(data) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = (line.words || [])
          .filter((w) => w.text && w.text.trim() && w.confidence > 20)
          .map((w) => ({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, y1: w.bbox.y1 }));
        if (!words.length) continue;
        const b = line.baseline;
        const slope = b && b.x1 !== b.x0 ? (b.y1 - b.y0) / (b.x1 - b.x0) : 0;
        const baselineAt = (x) => (b && Number.isFinite(b.y0) && b.y0 > 0 ? b.y0 + (x - b.x0) * slope : null);
        const lineHeight = line.bbox.y1 - line.bbox.y0;
        const size = Math.max(4, line.rowAttributes?.rowHeight || lineHeight);
        words.forEach((w) => { w.baseline = baselineAt(w.x0) ?? w.y1; });
        out.push({ words, size });
      }
    }
  }
  return out;
}

/**
 * Write recognised words as invisible (render mode 3) text over a page.
 * @param {any} page pdf-lib page
 * @param {any} font embedded standard font (Helvetica)
 * @param {{lines: any[]}} result from engine.recognize
 * @param {{width:number, height:number}} image the rendered canvas size (pixels)
 */
export async function addInvisibleText(page, font, result, image) {
  const PDFLib = await loadPdfLib();
  const {
    pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize,
    setTextRenderingMode, TextRenderingMode, setTextMatrix, showText,
  } = PDFLib;
  const charset = font.__charset || (font.__charset = new Set(font.getCharacterSet?.() || []));
  const clean = (s) => [...s].filter((ch) => !charset.size || charset.has(ch.codePointAt(0))).join('');

  const { W, H, rot, toPage } = visualGeometry(page);
  const sx = W / image.width;   // pixels → points (visual space)
  const sy = H / image.height;
  const theta = (rot * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const fontKey = page.node.newFontDictionary('OCRText', font.ref);

  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  let count = 0;
  for (const line of result.lines) {
    const size = line.size * sy;
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const next = line.words[i + 1];
      let text = clean(w.text);
      if (!text) continue;
      // Include the following space and stretch it up to the next word, so copied text has proper spaces.
      const right = next ? next.x0 : w.x1;
      if (next) text += ' ';
      let natural;
      try { natural = font.widthOfTextAtSize(text, size); } catch { continue; }
      const target = Math.max(1, (right - w.x0) * sx);
      const stretch = natural > 0 ? target / natural : 1;
      const u = w.x0 * sx;
      const v = H - w.baseline * sy;
      const { x, y } = toPage(u, v);
      ops.push(
        setFontAndSize(fontKey, size),
        setTextMatrix(stretch * cos, stretch * sin, -sin, cos, x, y),
        showText(font.encodeText(text)),
      );
      count++;
    }
  }
  ops.push(endText(), popGraphicsState());
  if (count) page.pushOperators(...ops);
  return count;
}

/**
 * Does this PDF.js page already contain real text? (Born-digital pages don't need OCR.)
 * @returns {Promise<string|null>} the existing text, or null if (almost) none
 */
export async function existingPageText(pdfjsDoc, pageNumber) {
  const page = await pdfjsDoc.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    return text.replace(/\s+/g, '').length >= 20 ? text.trim() : null;
  } finally {
    page.cleanup();
  }
}
