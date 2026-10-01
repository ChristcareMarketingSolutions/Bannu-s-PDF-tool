/**
 * Lazy loaders for the heavy third-party libraries.
 *
 * Nothing is downloaded until a tool actually needs it, and every library is
 * served from this site's own /lib folder (no CDN, no third-party requests).
 * Paths are resolved relative to this module, so the app works from any
 * GitHub Pages sub-directory (e.g. https://user.github.io/bannu-pdf-tools/).
 */
import { AppError } from './errors.js';

// Resolved against the page URL, so it works from a GitHub Pages
// sub-directory and when index.html is opened directly from disk (file://).
const libUrl = (path) => new URL(`lib/${path}`, document.baseURI).href;
const isFileProtocol = location.protocol === 'file:';

const cache = new Map();

function loadClassicScript(src, globalName) {
  if (cache.has(src)) return cache.get(src);
  const promise = new Promise((resolve, reject) => {
    if (window[globalName]) { resolve(window[globalName]); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => (window[globalName]
      ? resolve(window[globalName])
      : reject(new AppError('A required component failed to initialise. Please reload the page.', 'lib')));
    script.onerror = () => {
      cache.delete(src);
      reject(new AppError('A required component could not be loaded. Check your connection and reload the page.', 'lib'));
    };
    document.head.appendChild(script);
  });
  cache.set(src, promise);
  return promise;
}

/**
 * pdf-lib (the @cantoo/pdf-lib fork — API compatible with pdf-lib, adds
 * AES-256 encryption and decryption of password-protected PDFs).
 * @returns {Promise<any>} the PDFLib namespace
 */
export function loadPdfLib() {
  return loadClassicScript(libUrl('pdf-lib/pdf-lib.min.js'), 'PDFLib');
}

/** JSZip — builds ZIP archives entirely in the browser. */
export function loadJSZip() {
  return loadClassicScript(libUrl('jszip/jszip.min.js'), 'JSZip');
}

/**
 * Mozilla PDF.js (legacy build for broad browser support).
 *
 * Normally PDF.js parses PDFs in a Web Worker (off the main thread). Browsers
 * don't allow workers on pages opened straight from disk (file://), so in that
 * case the worker code is loaded as a normal script and PDF.js runs it on the
 * main thread instead — slower for huge files, but everything still works.
 */
export function loadPdfjs() {
  const key = 'pdfjs';
  if (cache.has(key)) return cache.get(key);
  const workerUrl = libUrl('pdfjs/pdf.worker.min.js');
  const promise = (isFileProtocol ? loadClassicScript(workerUrl, 'pdfjsWorker') : Promise.resolve())
    .then(() => loadClassicScript(libUrl('pdfjs/pdf.min.js'), 'pdfjsLib'))
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })
    .catch(() => {
      cache.delete(key);
      throw new AppError('The PDF preview engine could not be loaded. Please reload the page.', 'lib');
    });
  cache.set(key, promise);
  return promise;
}

/**
 * PDF.js needs "CMap" files to display some CJK (Chinese/Japanese/Korean)
 * PDFs. Instead of shipping ~170 small files, they are packed into one
 * lib/pdfjs/cmaps.zip (keeps the repo small enough for GitHub's web
 * uploader) and only downloaded the first time a PDF actually needs one.
 */
let cmapZipPromise = null;
class ZipCMapReaderFactory {
  async fetch({ name }) {
    if (!cmapZipPromise) {
      if (isFileProtocol) throw new Error('CMaps need http(s)');
      cmapZipPromise = Promise.all([loadJSZip(), fetch(libUrl('pdfjs/cmaps.zip')).then((r) => {
        if (!r.ok) throw new Error('CMap archive unavailable');
        return r.arrayBuffer();
      })]).then(([JSZip, buf]) => JSZip.loadAsync(buf));
      cmapZipPromise.catch(() => { cmapZipPromise = null; });
    }
    const zip = await cmapZipPromise;
    const entry = zip.file(`${name}.bcmap`);
    if (!entry) throw new Error(`Unknown CMap: ${name}`);
    return { cMapData: await entry.async('uint8array'), isCompressed: true };
  }
}

/** Common options for every PDF.js getDocument call. */
export function pdfjsDocumentOptions() {
  return {
    CMapReaderFactory: ZipCMapReaderFactory,
    cMapPacked: true,
    useWorkerFetch: false,
    // fetch() of local files is blocked on file:// — PDF.js then falls back to system fonts.
    standardFontDataUrl: isFileProtocol ? undefined : libUrl('pdfjs/standard_fonts/'),
    isEvalSupported: false,
    disableAutoFetch: true,
    stopAtErrors: false,
  };
}

/** Warm up libraries in the background (called when a tool opens). */
export function preload(names = []) {
  const map = { pdflib: loadPdfLib, pdfjs: loadPdfjs, jszip: loadJSZip };
  names.forEach((n) => map[n]?.().catch(() => {}));
}
