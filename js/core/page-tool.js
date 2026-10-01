/**
 * Shared workflow for every "one PDF in → page viewer → options → output" tool
 * (Split, Extract, Delete, Reorder, Rotate, PDF→Images, Compress, Watermark,
 * Page Numbers, Protect, Unlock).
 *
 *   empty (drop zone) → loading → ready (viewer + options) → processing → done
 *
 * A tool only describes what is different: viewer features, its options form
 * and its `run()` function. See js/tools/*.js for examples.
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { button, dropzone, messageSlot, progress, resultPanel } from './ui.js';
import { PdfViewer } from './pdf-viewer.js';
import { openWithPdfjs } from './pdf-loader.js';
import { previewFirstPage } from './render.js';
import { makeZip } from './zip.js';
import { formatBytes, plural, isPdfFile, outputName } from './utils.js';
import { friendlyMessage, isAbortError, logError } from './errors.js';

/**
 * @param {object} ctx  workspace context from app.js
 * @param {object} cfg
 * @param {string} cfg.actionLabel
 * @param {string} [cfg.actionIcon]
 * @param {{select?:boolean, rotate?:boolean, remove?:boolean, reorder?:boolean}} [cfg.features]
 * @param {'all'|'none'} [cfg.initialSelection]
 * @param {boolean} [cfg.noViewer]   hide the page grid (tools that don't need it)
 * @param {(viewer: PdfViewer) => HTMLElement[]} [cfg.toolbar]
 * @param {(api: object) => {el: HTMLElement, read: () => any, onViewerChange?: () => void}} cfg.options
 * @param {(job: object) => Promise<{files: {blob: Blob, name: string}[], message?: string, stats?: string[], note?: string}>} cfg.run
 */
export function createPageTool(ctx, cfg) {
  const state = { file: null, password: undefined, numPages: 0, viewer: null, options: null, busy: false, readyEl: null };
  const messages = messageSlot();

  function renderEmpty(errorMsg) {
    destroyViewer();
    const dz = dropzone({
      accept: 'application/pdf,.pdf',
      multiple: false,
      title: 'Drop your PDF here',
      hint: cfg.dropHint || 'or click to browse — your file stays on this device',
      onFiles: (files) => acceptFiles(files),
    });
    clear(ctx.root).append(h('div', { class: 'tool-empty' },
      h('p', { class: 'tool-intro' }, ctx.tool.longDescription || ctx.tool.description),
      messages.el,
      dz.el));
    if (errorMsg) messages.error(errorMsg); else messages.clear();
  }

  async function acceptFiles(files) {
    if (state.busy) return;
    const file = files.find(isPdfFile);
    if (!file) { renderEmpty('Please choose a PDF file (.pdf).'); return; }
    if (files.length > 1) ctx.toast('This tool works with one PDF at a time — using the first one.', 'info');
    await load(file);
  }

  async function load(file) {
    state.busy = true;
    destroyViewer();
    clear(ctx.root).append(h('div', { class: 'tool-loading', role: 'status' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', {}, `Opening "${file.name}"…`)));
    try {
      const { doc, password, numPages } = await openWithPdfjs(file, { signal: ctx.signal });
      if (ctx.signal.aborted) { doc.destroy(); return; }
      Object.assign(state, { file, password, numPages });
      if (cfg.noViewer) {
        doc.destroy();
      } else {
        state.viewer = new PdfViewer({
          doc, numPages,
          features: cfg.features || {},
          initialSelection: cfg.initialSelection || 'none',
          toolbarExtras: [],
          onChange: (_v, info) => {
            if (info?.warning) messages.warn(info.warning); else messages.clear();
            state.options?.onViewerChange?.();
          },
        });
        const extras = cfg.toolbar?.(state.viewer) || [];
        if (extras.length) state.viewer.toolbar.querySelector('.viewer-status').before(h('div', { class: 'toolbar-group toolbar-extras' }, extras));
      }
      state.options = cfg.options({ viewer: state.viewer, numPages, file, password, messages });
      renderReady();
    } catch (err) {
      if (isAbortError(err)) return;
      logError('open', err);
      renderEmpty(friendlyMessage(err));
    } finally {
      state.busy = false;
    }
  }

  function renderReady() {
    const { file, numPages } = state;
    const fileBar = h('div', { class: 'file-bar' },
      h('span', { class: 'file-bar-icon', 'aria-hidden': 'true' }, icon('file', { size: 20 })),
      h('div', { class: 'file-bar-text' },
        h('p', { class: 'file-bar-name', title: file.name }, file.name),
        h('p', { class: 'file-bar-meta' }, `${plural(numPages, 'page')} · ${formatBytes(file.size)}${state.password !== undefined ? ' · unlocked' : ''}`)),
      button('Change file', { variant: 'secondary', size: 'sm', iconName: 'refresh', onClick: () => renderEmpty() }));

    state.actionBtn = button(cfg.actionLabel, { variant: 'primary', size: 'lg', iconName: cfg.actionIcon || 'zap', onClick: run, className: 'btn-block' });
    state.actionArea = h('div', { class: 'action-area' }, state.actionBtn);
    const side = h('aside', { class: 'tool-side panel', 'aria-label': 'Options' },
      h('h3', { class: 'panel-title' }, 'Options'),
      state.options.el,
      messages.el,
      state.actionArea,
      h('p', { class: 'side-privacy' }, icon('shield', { size: 14 }), h('span', {}, 'Processed locally — never uploaded.')));

    const main = h('section', { class: 'tool-main panel', 'aria-label': 'Document' }, fileBar, state.viewer ? state.viewer.el : null);
    state.readyEl = h('div', { class: `tool-layout${state.viewer ? '' : ' tool-layout-noviewer'}` }, main, side);
    clear(ctx.root).append(state.readyEl);
    state.options.onViewerChange?.();
  }

  async function run() {
    if (state.busy) return;
    messages.clear();
    let options;
    try {
      options = state.options.read();
    } catch (err) {
      messages.error(friendlyMessage(err), 'Please check your options');
      return;
    }
    state.busy = true;
    ctx.setBusy(true);
    const bar = progress(cfg.progressLabel || 'Processing PDF...');
    state.actionArea.replaceChildren(bar.el);
    try {
      const result = await cfg.run({
        file: state.file,
        password: state.password,
        numPages: state.numPages,
        viewer: state.viewer,
        pages: state.viewer?.getPages(),
        options,
        progress: bar,
        signal: ctx.signal,
      });
      if (ctx.signal.aborted) return;
      await showResult(result);
    } catch (err) {
      if (isAbortError(err)) return;
      logError(ctx.tool.id, err);
      state.actionArea.replaceChildren(state.actionBtn);
      messages.error(friendlyMessage(err, "We couldn't process this PDF. It may be corrupted or password protected."));
    } finally {
      state.busy = false;
      ctx.setBusy(false);
    }
  }

  async function showResult(result) {
    const { files } = result;
    let preview = null;
    if (files.length === 1 && files[0].blob.type === 'application/pdf' && !result.noPreview) {
      try {
        const { blob } = await previewFirstPage(new Uint8Array(await files[0].blob.arrayBuffer()), 240);
        preview = h('img', { src: ctx.registry.create(blob), alt: 'Preview of the first page of the result' });
      } catch { /* preview is optional (e.g. encrypted output) */ }
    } else if (files.length && files.every((f) => f.blob.type.startsWith('image/'))) {
      preview = h('div', { class: 'result-image-grid' }, files.slice(0, 8).map((f) => h('img', { src: ctx.registry.create(f.blob), alt: f.name })));
    }
    const actions = [];
    if (state.readyEl) actions.push({ label: 'Back to editing', iconName: 'arrowLeft', onClick: () => { clear(ctx.root).append(state.readyEl); state.actionArea.replaceChildren(state.actionBtn); } });
    actions.push({ label: 'Process another PDF', iconName: 'refresh', onClick: () => renderEmpty() });
    const panel = resultPanel({
      files,
      zip: () => makeZip(files, outputName(state.file.name, cfg.zipSuffix || ctx.tool.id, 'zip')),
      message: result.message,
      stats: result.stats || (files.length === 1 ? [files[0].name, formatBytes(files[0].blob.size)] : []),
      note: result.note,
      preview,
      actions,
      registry: ctx.registry,
    });
    clear(ctx.root).append(panel);
  }

  function destroyViewer() {
    state.viewer?.destroy();
    state.viewer = null;
    state.options = null;
    state.readyEl = null;
  }

  renderEmpty();
  if (ctx.files?.length) acceptFiles(ctx.files);

  return {
    acceptFiles,
    destroy: destroyViewer,
  };
}

/** Standard selection buttons for tools that select pages. */
export function selectionToolbar(viewer) {
  return [
    button('All', { variant: 'ghost', size: 'sm', onClick: () => viewer.selectAll(), ariaLabel: 'Select all pages' }),
    button('None', { variant: 'ghost', size: 'sm', onClick: () => viewer.selectNone(), ariaLabel: 'Clear selection' }),
    button('Invert', { variant: 'ghost', size: 'sm', onClick: () => viewer.invertSelection(), ariaLabel: 'Invert selection' }),
  ];
}
