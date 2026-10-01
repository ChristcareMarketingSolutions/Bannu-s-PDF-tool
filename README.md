# Bannu's PDF Tool

Professional PDF tools that run entirely in your browser.

Bannu's PDF Tool is a static web application for everyday PDF work: merge, split, extract, delete, reorder, rotate, convert, compress, watermark, number, protect and unlock PDFs. Every operation happens **on your own device** using JavaScript. There is no server, no account and no upload.

Created by **Subhash Vundavalli** · [LinkedIn](https://www.linkedin.com/in/subhashvundavalli)

---

## Features

| Tool | What it does |
|---|---|
| **Merge PDF** | Combine multiple PDFs. Drag to reorder, add more files, remove files, set the output name. Shows size, page count and a first-page thumbnail for each file. |
| **Split PDF** | Split by custom ranges (`1-5, 6-10, 11-`), every N pages, or one file per selected page. Multiple results download as a ZIP. |
| **Extract Pages** | Select pages by clicking thumbnails or typing ranges (with All / None / Invert / Odd / Even helpers). Output as one PDF or one PDF per page. |
| **Delete Pages** | Mark pages for removal (click or type), then export. Removal is done in place, so bookmarks, links and form fields on the remaining pages are kept. |
| **Reorder Pages** | Drag-and-drop pages (mouse, touch or keyboard), reverse, reset, then export. |
| **Rotate PDF** | Rotate single pages, selected pages or all pages by 90°/180°. Lossless (uses the PDF `/Rotate` attribute). |
| **PDF to Images** | Convert all or selected pages to PNG or JPG at 72–300 DPI. |
| **Images to PDF** | JPG, PNG, WebP, GIF, BMP → one PDF. Page size (fit / A4 / Letter / Legal / A3), orientation and margins. Phone photos are automatically kept upright (EXIF orientation). |
| **Compress PDF** | Three levels: lossless clean-up, image optimisation (keeps text sharp), or maximum compression (rasterise). |
| **Watermark PDF** | Text watermark with font, colour, size, opacity, angle, centred or tiled layout, and page selection. |
| **Page Numbers** | Six positions, five formats (`1`, `Page 1`, `Page 1 of 10`, `1 / 10`, `- 1 -`), start number, size, margin, colour, skip cover page, page ranges. |
| **Protect PDF** | AES-256 password encryption with permission settings (printing, copying, editing, comments/forms) and optional owner password. |
| **Unlock PDF** | Enter the password once and save an unlocked copy (also removes owner restrictions). |

**Also included**

- Reusable PDF viewer: thumbnails, page numbers, selection, thumbnail zoom, a large **Preview** mode with previous/next and zoom in/out/fit, rotate, delete and drag-to-reorder.
- Drag-and-drop everywhere: drop files on the home page (one PDF → choose a tool; several PDFs → Merge; images → Images to PDF) or directly into any tool.
- Password-protected PDFs open in every tool after you enter the password.
- Progress bars for long jobs, friendly error messages, a result screen with a preview of the output, single downloads or ZIP.
- Tool search (press <kbd>/</kbd>) and category filters (Organize, Convert, Edit & optimize, Security), light and dark themes, deep links (e.g. `…/#merge`), fully responsive (desktop, tablet, Android, iPhone).

---

## Technologies

| Library | Version | Used for | Licence |
|---|---|---|---|
| [pdf-lib](https://pdf-lib.js.org/) — via the [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib) fork | 2.x | Merging, splitting, page edits, rotation, watermarks, page numbers, creating PDFs, AES-256 encryption & decryption | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`, legacy build) | 4.10 | Rendering thumbnails, previews and images | Apache-2.0 |
| [JSZip](https://stuk.github.io/jszip/) | 3.10 | Creating ZIP downloads in the browser | MIT |
| [Inter](https://rsms.me/inter/) (self-hosted) | 4 | Typography | SIL OFL 1.1 |

No frameworks: plain HTML, CSS and JavaScript modules. The modules in `js/` are combined into one file, `js/app.bundle.js`, so the site also works when `index.html` is opened directly from disk. The bundle is already built — you only rebuild it if you edit the JavaScript (see *Adding a new tool*). All libraries are **bundled in `lib/`** — the site makes no requests to any CDN or third-party server.

---

## Privacy architecture

```
Your device ─────────────────────────────────────────────────────
  Browser
    └─ File picker / drag & drop  →  File object (stays in memory)
         └─ JavaScript (pdf-lib, PDF.js in a Web Worker)
              └─ New PDF / images as a Blob
                   └─ Download (blob: URL)
──────────────────────────────────────────────────────────────────
GitHub Pages only serves the static app files (HTML/CSS/JS). It never receives your PDFs.
```

- **No backend.** There is no server code, database, analytics or tracking.
- **Enforced by the browser.** `index.html` sets a Content-Security-Policy with `connect-src 'self' blob: data:` — the page is technically unable to send data to any other domain. Scripts, workers and fonts are also limited to the site itself.
- **No third-party requests.** Fonts and libraries are self-hosted (the font is embedded in the stylesheet), so even your IP address is never shared with a CDN.
- **Passwords** you enter (to open or protect a PDF) are used only in memory and are never stored.
- **Memory hygiene.** Blob URLs are revoked when a tool closes, PDF.js documents are destroyed, and large canvases are released immediately.
- The only things stored in your browser are your theme choice (light/dark) in `localStorage`.

---

## How PDF processing works

1. **Opening** — files are read with `File.arrayBuffer()`. PDF.js opens the document in a Web Worker to count pages and render thumbnails lazily (only pages near the viewport, max 2 at a time, stored as small JPEG blobs).
2. **Editing** — your choices (selection, order, rotation, removal) are kept as a light page model `{ src, rotation, selected, removed }`. Nothing is modified until you click the action button.
3. **Building** — pdf-lib loads the original bytes and either edits the document in place (rotate, delete, watermark, page numbers, protect) or copies the chosen pages into a new document (merge, split, extract, reorder). Copying happens in one `copyPages` call per output so shared fonts and images are not duplicated.
4. **Saving** — the result is serialized with compressed object streams into a `Blob` and downloaded via a temporary `blob:` URL. Multiple outputs are zipped with JSZip.

### Compression engine (`js/core/compress-engine.js`)

| Level | Strategy | Keeps text selectable |
|---|---|---|
| Light | Mark-and-sweep removal of unreachable objects + object streams | ✅ |
| Recommended | Light + re-encodes embedded JPEG photos (≈62 % quality, max 1700 px) using the browser's image codecs | ✅ |
| Strong | Renders each page to a JPEG (110 DPI) and rebuilds the PDF | ❌ |

If the output isn't smaller, the original file is returned unchanged. The engine is isolated behind a strategy table, so a stronger engine (for example a WebAssembly build of qpdf or Ghostscript) can be plugged in later without touching the UI.

---

## Project structure

```
bannu-pdf-tools/
├── index.html              App shell, header, footer, workspace <dialog>, CSP
├── README.md
├── package.json            Build script (only needed if you change the JavaScript)
├── .nojekyll               Tells GitHub Pages to serve files as-is
├── css/
│   └── styles.css          Design tokens, light/dark themes, all components, responsive rules
├── js/
│   ├── app.bundle.js       ← the file the page loads (built from the modules below)
│   ├── app.js              Entry: tool grid, search, categories, theme, workspace modal, deep links, drag & drop
│   ├── theme-init.js       Applies the saved theme before first paint
│   ├── core/
│   │   ├── dom.js          Safe DOM builder (no innerHTML)
│   │   ├── icons.js        Inline SVG icon set
│   │   ├── utils.js        Limits, formatting, filename sanitising, page-range parser
│   │   ├── errors.js       AppError + friendly error messages
│   │   ├── libs.js         Lazy loaders for pdf-lib, PDF.js, JSZip
│   │   ├── ui.js           Buttons, fields, drop zone, progress, toasts, password prompt, result panel
│   │   ├── pdf-loader.js   Opening PDFs with password support
│   │   ├── pdf-tools.js    pdf-lib engine: build/merge pages, watermark, page numbers, encryption, GC
│   │   ├── render.js       PDF.js rendering + concurrency-limited render queue
│   │   ├── pdf-viewer.js   Reusable viewer (grid + preview, select/rotate/remove/reorder)
│   │   ├── sortable.js     Pointer-event drag-to-reorder (mouse, touch, keyboard)
│   │   ├── file-queue.js   Reorderable file list (Merge, Images to PDF)
│   │   ├── page-tool.js    Shared workflow for single-PDF tools
│   │   ├── queue-tool.js   Shared workflow for multi-file tools
│   │   ├── compress-engine.js
│   │   ├── image-utils.js  EXIF orientation, image decoding/re-encoding
│   │   └── zip.js          ZIP packaging
│   └── tools/
│       ├── registry.js     ← list of all tools (add new tools here)
│       ├── merge.js  split.js  extract.js  delete.js  reorder.js  rotate.js
│       ├── pdf-to-images.js  images-to-pdf.js  compress.js
│       └── watermark.js  page-numbers.js  protect.js  unlock.js
├── assets/
│   ├── icons/favicon.svg
│   └── fonts/              Inter (self-hosted) + licence
└── lib/                    Third-party libraries (bundled, with licences)
    ├── pdf-lib/pdf-lib.min.js
    ├── pdfjs/pdf.min.js, pdf.worker.min.js, standard_fonts/, cmaps.zip (classic-script builds of PDF.js)
    └── jszip/jszip.min.js
```

---

## Run locally

**Easiest:** unzip and **double-click `index.html`**. Everything works straight from your disk (`file://`).

When opened from disk, browsers apply a few restrictions, so the app automatically adapts:

- PDF parsing runs on the main thread instead of a background worker (very large PDFs feel a bit slower).
- PDFs whose fonts are *not embedded* may preview with substitute fonts, and some CJK (Chinese/Japanese/Korean) text may not preview. Your output files are not affected.

For the full experience (exactly like GitHub Pages), serve the folder instead:

```bash
cd bannu-pdf-tools
python3 -m http.server 8080      # or: npx serve .
```

Then open <http://localhost:8080>.

### How to test it

1. Click any tool card (for example **Merge PDF**).
2. Click **Browse files** (or drag PDFs onto the drop area / anywhere on the page).
3. Adjust the options, click the action button, then **Download**.

---

## Deploy to GitHub Pages

### Option A — upload in the browser (no Git needed)

1. Unzip `bannu-pdf-tools.zip` on your computer.
2. On GitHub, click **New repository** → name it e.g. `bannu-pdf-tools` → **Public** → **Create repository**.
3. On the empty repository page click **uploading an existing file**.
4. Open the unzipped `bannu-pdf-tools` folder, select **everything inside it** (`index.html`, `README.md`, `css`, `js`, `assets`, `lib`, …) and drag it into the upload area.
   - The project has fewer than 100 files, so it fits in a single upload.
   - Upload the *contents* of the folder, so `index.html` sits at the repository root.
   - `.nojekyll` is a hidden file; if your file browser hides it, that's fine — the site works without it.
5. Click **Commit changes**.
6. Go to **Settings → Pages**. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, and click **Save**.
7. After 1–2 minutes your site is live at:
   `https://<your-username>.github.io/bannu-pdf-tools/`

### Option B — using Git

```bash
cd bannu-pdf-tools
git init
git add .
git commit -m "Bannu's PDF Tool"
git branch -M main
git remote add origin https://github.com/<your-username>/bannu-pdf-tools.git
git push -u origin main
```

Then enable Pages as in step 6 above.

**Why it works on GitHub Pages:** every path is relative, libraries are resolved relative to the page, routing uses `#hash` deep links (no server routing; refresh never 404s), and no environment variables or server are required. It also works from a custom domain or the root `username.github.io` repository.

---

## Limitations

- **Very large files** are limited by the device's memory. The app caps PDFs at 300 MB each and 600 MB per job; phones may struggle well before that.
- **Compression** in the browser cannot match server tools like Ghostscript. "Recommended" only recompresses JPEG photos (not Flate/PNG-style images, CMYK images or JPEG 2000); "Strong" makes text unselectable.
- **Watermark / page-number text** uses the standard PDF fonts, which support Latin characters (incl. accents, €, etc.) but not emoji or non-Latin scripts such as Telugu, Hindi or Chinese. The app tells you if a character is unsupported.
- **Merge / split / extract / reorder** create a new document from copied pages, so document-level features (bookmarks/outline, some form fields, tagged-PDF structure) of the source may not be carried over. Rotate, delete, watermark, page numbers and protect edit the original in place and keep them.
- **Protect PDF** uses AES-256, supported by all current readers (Acrobat 9+ and newer). Permission flags are honoured by most — but not all — PDF apps.
- **Digital signatures** are invalidated by any modification (as with every PDF editor).
- XFA (dynamic Adobe LiveCycle) forms are not supported.
- Tested in current Chromium-based browsers; also designed for Firefox, Safari (macOS/iOS) and Android Chrome. Some subtle styling (`:has()`, `color-mix()`) degrades gracefully in older browsers.

---

## Future improvements

- WebAssembly compression engine (qpdf / Ghostscript / MuPDF) for stronger, text-preserving compression.
- Unicode font embedding (via `@pdf-lib/fontkit`) for watermarks and page numbers in any language.
- Preserving bookmarks/outlines when merging and splitting.
- OCR (e.g. Tesseract.js) to make scanned PDFs searchable.
- Sign PDF, fill forms, crop pages, PDF → text, HTML → PDF.
- Offline support with a service worker (installable PWA).
- Moving heavy pdf-lib work to a Web Worker for even smoother UI on very large files.

---

## Adding a new tool

1. **Create** `js/tools/my-tool.js`. Most tools take ~50 lines using the shared workflows:

   ```js
   import { h } from '../core/dom.js';
   import { createPageTool } from '../core/page-tool.js';
   import { loadPdfLibDoc } from '../core/pdf-loader.js';
   import { saveToBlob } from '../core/pdf-tools.js';
   import { outputName } from '../core/utils.js';

   export default function mount(ctx) {
     return createPageTool(ctx, {
       actionLabel: 'Do the thing',
       features: { select: true },          // viewer: select / rotate / remove / reorder
       options: ({ viewer }) => ({
         el: h('div', { class: 'options' }, 'Your option controls here'),
         read: () => ({ pages: viewer.selectedSources() }), // throw AppError to show a validation message
       }),
       async run({ file, password, options, progress }) {
         const doc = await loadPdfLibDoc(file, password, file.name);
         // …modify `doc` with pdf-lib…
         return { files: [{ blob: await saveToBlob(doc), name: outputName(file.name, 'done') }] };
       },
     });
   }
   ```

   For multi-file tools use `createQueueTool` (see `merge.js`, `images-to-pdf.js`).

2. **Register** it in `js/tools/registry.js`:

   ```js
   { id: 'my-tool', category: 'optimize', name: 'My Tool', icon: 'file', accepts: 'pdf',
     description: 'One-line description for the card.',
     keywords: 'search words', libs: ['pdfjs', 'pdflib'],
     load: () => import('./my-tool.js') },
   ```

3. **Rebuild the bundle** (requires [Node.js](https://nodejs.org)):

   ```bash
   npm install       # first time only
   npm run build     # writes js/app.bundle.js
   ```

That's it — the card, search, deep link (`#my-tool`), drag-and-drop, progress, errors and download screen all work automatically. New icons can be added to `js/core/icons.js`.

---

© 2026 Bannu's PDF Tool · Created by Subhash Vundavalli
