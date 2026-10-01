/**
 * PDF.js rendering helpers: thumbnails, full-size page renders and a small
 * concurrency-limited render queue so huge documents never render thousands
 * of pages at once.
 */
import { loadPdfjs, pdfjsDocumentOptions } from './libs.js';
import { canvasToBlob, fitCanvasSize, releaseCanvas } from './utils.js';

/**
 * Render one page to a new canvas.
 * @param {any} doc  PDF.js document proxy
 * @param {number} pageNumber 1-based
 * @param {{scale?: number, width?: number, rotation?: number, background?: string}} opts
 *   `rotation` is *extra* rotation added on top of the page's own /Rotate.
 */
export async function renderPageToCanvas(doc, pageNumber, { scale, width, rotation = 0, background = '#ffffff' } = {}) {
  const page = await doc.getPage(pageNumber);
  const totalRotation = (((page.rotate + rotation) % 360) + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation: totalRotation });
  let s = scale ?? (width ? width / base.width : 1);
  const fitted = fitCanvasSize(Math.ceil(base.width * s), Math.ceil(base.height * s));
  s *= fitted.scale;
  const viewport = page.getViewport({ scale: s, rotation: totalRotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, viewport, background });
  try {
    await task.promise;
  } finally {
    page.cleanup();
  }
  return { canvas, task, width: base.width, height: base.height };
}

/** Render a page into a small JPEG Blob (cheap to keep in memory). */
export async function renderThumbnailBlob(doc, pageNumber, targetWidth = 220) {
  const { canvas, width, height } = await renderPageToCanvas(doc, pageNumber, { width: targetWidth });
  try {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    return { blob, width, height };
  } finally {
    releaseCanvas(canvas);
  }
}

/** Render the first page of PDF bytes into an <img>-ready Blob (used for result previews). */
export async function previewFirstPage(bytes, targetWidth = 260) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ ...pdfjsDocumentOptions(), data: bytes }).promise;
  try {
    return await renderThumbnailBlob(doc, 1, targetWidth);
  } finally {
    doc.destroy();
  }
}

/**
 * A tiny priority queue that renders at most `concurrency` pages at once.
 * Jobs that are no longer needed (scrolled out of view) can be cancelled.
 */
export class RenderQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.running = 0;
    this.jobs = new Map(); // key -> {fn, resolve, reject}
    this.destroyed = false;
  }

  /** Queue `fn` under `key` (a key that is already queued is not added twice). */
  add(key, fn) {
    if (this.destroyed) return Promise.reject(new Error('destroyed'));
    const existing = this.jobs.get(key);
    if (existing) return existing.promise;
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {});
    this.jobs.set(key, { fn, resolve, reject, promise });
    this.pump();
    return promise;
  }

  cancel(key) {
    const job = this.jobs.get(key);
    if (job) {
      this.jobs.delete(key);
      const err = new Error('cancelled');
      err.name = 'AbortError';
      job.reject(err);
    }
  }

  pump() {
    while (!this.destroyed && this.running < this.concurrency && this.jobs.size) {
      // First in, first out: pages render top-to-bottom. Jobs for pages that
      // scroll out of view are cancelled by the viewer before they start.
      const key = this.jobs.keys().next().value;
      const job = this.jobs.get(key);
      this.jobs.delete(key);
      this.running++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => { this.running--; this.pump(); });
    }
  }

  destroy() {
    this.destroyed = true;
    for (const key of [...this.jobs.keys()]) this.cancel(key);
  }
}
