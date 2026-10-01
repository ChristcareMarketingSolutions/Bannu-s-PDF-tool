/**
 * PDF manipulation engine built on pdf-lib.
 *
 * Every function here is pure "bytes in → bytes out" logic with no UI, which
 * keeps the tools thin and makes new tools easy to add.
 */
import { loadPdfLib } from './libs.js';
import { AppError } from './errors.js';
import { hexToRgb01, yieldToUI, throwIfAborted } from './utils.js';

const PDF_MIME = 'application/pdf';
const normalizeAngle = (a) => (((Math.round(a / 90) * 90) % 360) + 360) % 360;

/** Serialize a pdf-lib document into a Blob. */
export async function saveToBlob(doc, { useObjectStreams = true } = {}) {
  const bytes = await doc.save({ useObjectStreams, updateFieldAppearances: false });
  return new Blob([bytes], { type: PDF_MIME });
}

/** Set friendly producer metadata on generated documents. */
function stamp(doc, title) {
  try {
    doc.setProducer('Bannu\'s PDF Tool');
    doc.setCreator('Bannu\'s PDF Tool');
    if (title) doc.setTitle(title, { showInWindowTitleBar: false });
    doc.setModificationDate(new Date());
  } catch { /* metadata is optional */ }
}

/**
 * Build a new document from selected pages of a source document.
 * @param {any} srcDoc pdf-lib PDFDocument
 * @param {{src:number, rotation?:number}[]} pages pages in output order (0-based `src`)
 */
export async function buildFromPages(srcDoc, pages, { title } = {}) {
  const { PDFDocument, degrees } = await loadPdfLib();
  if (!pages.length) throw new AppError('Please select at least one page.', 'range');
  const out = await PDFDocument.create();
  // One copyPages call per output so shared resources (fonts, images) are copied once.
  const copied = await out.copyPages(srcDoc, pages.map((p) => p.src));
  copied.forEach((page, i) => {
    const extra = pages[i].rotation || 0;
    if (extra) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + extra)));
    out.addPage(page);
  });
  stamp(out, title);
  return out;
}

/**
 * Merge several pdf-lib documents (in order) into one.
 * @param {() => AsyncGenerator<any>|any[]} sources iterable of PDFDocuments
 */
export async function mergeDocuments(loadNext, count, { onProgress, signal } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    throwIfAborted(signal);
    onProgress?.(i / count, i);
    const src = await loadNext(i);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
    await yieldToUI();
  }
  stamp(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometry: map "visual" coordinates (what the reader sees, after the */
/* page's /Rotate is applied) to raw PDF page space.                   */
/* ------------------------------------------------------------------ */

export function visualGeometry(page) {
  const rot = normalizeAngle(page.getRotation().angle);
  const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const { x: x0, y: y0, width: Wp, height: Hp } = box;
  const swap = rot === 90 || rot === 270;
  const W = swap ? Hp : Wp;
  const H = swap ? Wp : Hp;
  /** Convert visual (u, v) — origin bottom-left as displayed — to page (x, y). */
  const toPage = (u, v) => {
    switch (rot) {
      case 90: return { x: x0 + Wp - v, y: y0 + u };
      case 180: return { x: x0 + Wp - u, y: y0 + Hp - v };
      case 270: return { x: x0 + v, y: y0 + Hp - u };
      default: return { x: x0 + u, y: y0 + v };
    }
  };
  return { W, H, rot, toPage };
}

/** Throws a friendly error if the standard font cannot encode the text. */
function measure(font, text, size) {
  // Standard PDF fonts only cover the Latin (WinAnsi) character set. Some
  // pdf-lib builds silently replace other characters with "?", so check first.
  const supported = font.__charset || (font.__charset = new Set(font.getCharacterSet?.() || []));
  if (supported.size) {
    const bad = [...text].filter((ch) => !supported.has(ch.codePointAt(0)));
    if (bad.length) {
      throw new AppError(`The built-in PDF fonts can't display ${[...new Set(bad)].slice(0, 5).map((c) => `"${c}"`).join(', ')}. Please use Latin letters, numbers and common punctuation.`, 'font');
    }
  }
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    throw new AppError('This text contains characters the built-in PDF fonts cannot display (for example emoji or non-Latin scripts). Please use basic Latin letters, numbers and punctuation.', 'font');
  }
}

/* ------------------------------------------------------------------ */
/* Watermark                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {any} doc pdf-lib document (modified in place)
 * @param {{text:string, fontSize:number, opacity:number, color:string, angle:number, layout:'center'|'tile', font:'HelveticaBold'|'Helvetica'|'TimesRomanBold'|'CourierBold'}} o
 * @param {number[]} pageIndexes 0-based pages to watermark
 */
export async function addTextWatermark(doc, o, pageIndexes, { onProgress, signal } = {}) {
  const { StandardFonts, rgb, degrees } = await loadPdfLib();
  const text = String(o.text || '').trim();
  if (!text) throw new AppError('Please enter the watermark text.', 'input');
  const font = await doc.embedFont(StandardFonts[o.font] || StandardFonts.HelveticaBold);
  const c = hexToRgb01(o.color);
  const color = rgb(c.r, c.g, c.b);
  const pages = doc.getPages();
  const theta = (o.angle * Math.PI) / 180;

  for (let n = 0; n < pageIndexes.length; n++) {
    throwIfAborted(signal);
    const page = pages[pageIndexes[n]];
    const { W, H, rot, toPage } = visualGeometry(page);
    // Scale the font relative to page size so watermarks look consistent on A4 and A0 alike.
    const size = o.autoSize ? Math.max(8, Math.min(W, H) * (o.fontSize / 595)) : o.fontSize;
    const w = measure(font, text, size);
    const hgt = size * 0.7;

    const drawAt = (cx, cy) => {
      // Origin such that the text's centre lands on (cx, cy) after rotation by theta.
      const u = cx - ((w / 2) * Math.cos(theta) - (hgt / 2) * Math.sin(theta));
      const v = cy - ((w / 2) * Math.sin(theta) + (hgt / 2) * Math.cos(theta));
      const { x, y } = toPage(u, v);
      page.drawText(text, { x, y, size, font, color, opacity: o.opacity, rotate: degrees(o.angle + rot) });
    };

    if (o.layout === 'tile') {
      const stepX = w * Math.abs(Math.cos(theta)) + size * 3;
      const stepY = Math.max(size * 4, w * Math.abs(Math.sin(theta)) * 0.6 + size * 2.5);
      let row = 0;
      for (let cy = -stepY; cy < H + stepY; cy += stepY, row++) {
        for (let cx = (row % 2 ? stepX / 2 : 0) - stepX; cx < W + stepX; cx += stepX) drawAt(cx, cy);
      }
    } else {
      drawAt(W / 2, H / 2);
    }
    if (n % 20 === 0) { onProgress?.(n / pageIndexes.length); await yieldToUI(); }
  }
  stamp(doc);
  return doc;
}

/* ------------------------------------------------------------------ */
/* Page numbers                                                        */
/* ------------------------------------------------------------------ */

export const NUMBER_FORMATS = {
  plain: (n) => `${n}`,
  page: (n) => `Page ${n}`,
  pageOf: (n, t) => `Page ${n} of ${t}`,
  slash: (n, t) => `${n} / ${t}`,
  dash: (n) => `- ${n} -`,
};

/**
 * @param {any} doc pdf-lib document (modified in place)
 * @param {{position:string, format:keyof NUMBER_FORMATS, startAt:number, fontSize:number, margin:number, color:string, font:string}} o
 * @param {number[]} pageIndexes pages that receive a number (0-based, ascending)
 */
export async function addPageNumbers(doc, o, pageIndexes, { onProgress, signal } = {}) {
  const { StandardFonts, rgb, degrees } = await loadPdfLib();
  const font = await doc.embedFont(StandardFonts[o.font] || StandardFonts.Helvetica);
  const c = hexToRgb01(o.color);
  const color = rgb(c.r, c.g, c.b);
  const fmt = NUMBER_FORMATS[o.format] || NUMBER_FORMATS.plain;
  const pages = doc.getPages();
  const total = pageIndexes.length + o.startAt - 1;
  const [vertical, horizontal] = o.position.split('-'); // e.g. "bottom-center"

  for (let n = 0; n < pageIndexes.length; n++) {
    throwIfAborted(signal);
    const page = pages[pageIndexes[n]];
    const { W, H, rot, toPage } = visualGeometry(page);
    const label = fmt(n + o.startAt, total);
    const w = measure(font, label, o.fontSize);
    const u = horizontal === 'left' ? o.margin : horizontal === 'right' ? W - o.margin - w : (W - w) / 2;
    const v = vertical === 'top' ? H - o.margin - o.fontSize * 0.75 : o.margin;
    const { x, y } = toPage(u, v);
    page.drawText(label, { x, y, size: o.fontSize, font, color, rotate: degrees(rot) });
    if (n % 25 === 0) { onProgress?.(n / pageIndexes.length); await yieldToUI(); }
  }
  stamp(doc);
  return doc;
}

/* ------------------------------------------------------------------ */
/* Encryption                                                          */
/* ------------------------------------------------------------------ */

/**
 * Encrypt with AES-256 (supported by Acrobat 9+, Chrome, Edge, Firefox,
 * Safari/Preview and all modern PDF readers).
 */
export function encryptDocument(doc, { userPassword, ownerPassword, permissions }) {
  if (typeof doc.encrypt !== 'function') {
    throw new AppError('Password protection is not available in this build.', 'unsupported');
  }
  doc.encrypt({ userPassword, ownerPassword, permissions, algorithm: 'AES-256' });
  return doc;
}

/* ------------------------------------------------------------------ */
/* Garbage collection                                                  */
/* ------------------------------------------------------------------ */

/**
 * Mark-and-sweep garbage collection over the PDF object graph: anything not
 * reachable from the trailer (/Root, /Info) is deleted before saving.
 * @returns {number} number of removed objects
 */
export function collectGarbage(doc, { PDFRef, PDFDict, PDFArray, PDFStream }) {
  const context = doc.context;
  const reachable = new Set();
  const stack = [context.trailerInfo.Root, context.trailerInfo.Info].filter(Boolean);
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (reachable.has(obj.tag)) continue;
      reachable.add(obj.tag);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) { context.delete(ref); removed++; }
  }
  return removed;
}
