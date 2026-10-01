/**
 * Client-side ZIP packaging with JSZip.
 */
import { loadJSZip } from './libs.js';
import { sanitizeFilename, stripExtension } from './utils.js';

/** Ensure every name inside the archive is unique: "a.pdf", "a (2).pdf"… */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (!count) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${count + 1})${name.slice(dot)}` : `${name} (${count + 1})`;
  });
}

/**
 * @param {{blob: Blob, name: string}[]} files
 * @param {string} zipName
 * @param {(fraction:number)=>void} [onProgress]
 */
export async function makeZip(files, zipName, onProgress) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const names = uniqueNames(files.map((f) => f.name));
  // PDFs and images are already compressed, so STORE is much faster with ~no size penalty.
  files.forEach((f, i) => zip.file(names[i], f.blob, { compression: 'STORE', binary: true }));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', streamFiles: true }, (meta) => onProgress?.(meta.percent / 100));
  const base = sanitizeFilename(stripExtension(zipName || 'files'));
  return { blob, name: `${base}.zip` };
}
