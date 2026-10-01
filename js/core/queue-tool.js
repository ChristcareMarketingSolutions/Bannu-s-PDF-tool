/**
 * Shared workflow for multi-file tools (Merge PDF, Images to PDF):
 *
 *   drop zone → ordered file queue (+ add more) → options → process → done
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { button, dropzone, messageSlot, progress, resultPanel } from './ui.js';
import { FileQueue } from './file-queue.js';
import { previewFirstPage } from './render.js';
import { formatBytes } from './utils.js';
import { friendlyMessage, isAbortError, logError } from './errors.js';

/**
 * @param {object} ctx
 * @param {object} cfg
 * @param {'pdf'|'image'} cfg.kind
 * @param {string} cfg.accept
 * @param {string} cfg.dropTitle
 * @param {number} cfg.minFiles
 * @param {string} cfg.actionLabel
 * @param {(item) => Promise<object>} cfg.describe
 * @param {(api) => {el: HTMLElement, read: () => any}} cfg.options
 * @param {(job) => Promise<{files: {blob: Blob, name: string}[], stats?: string[], message?: string}>} cfg.run
 */
export function createQueueTool(ctx, cfg) {
  const messages = messageSlot();
  const noun = cfg.kind === 'pdf' ? 'PDF' : 'image';
  let busy = false;
  let readyEl = null;
  let actionBtn;
  let actionArea;
  let countLabel;

  const queue = new FileQueue({
    kind: cfg.kind,
    describe: cfg.describe,
    toast: ctx.toast,
    registry: ctx.registry,
    onChange: () => update(),
  });
  const options = cfg.options({ queue, messages });

  function renderEmpty() {
    readyEl = null;
    const dz = dropzone({ accept: cfg.accept, multiple: true, title: cfg.dropTitle, hint: cfg.dropHint || 'or click to browse — files never leave your device', onFiles: acceptFiles });
    clear(ctx.root).append(h('div', { class: 'tool-empty' },
      h('p', { class: 'tool-intro' }, ctx.tool.longDescription || ctx.tool.description),
      messages.el,
      dz.el));
  }

  function renderReady() {
    countLabel = h('h3', { class: 'panel-title' });
    const more = dropzone({ accept: cfg.accept, multiple: true, compact: true, title: `Drop more ${noun}s here`, buttonLabel: 'Add more files', onFiles: acceptFiles });
    const listHeader = h('div', { class: 'list-header' },
      countLabel,
      h('div', { class: 'toolbar-group' },
        button('Sort A–Z', { variant: 'ghost', size: 'sm', iconName: 'swap', onClick: () => queue.sortByName() }),
        button('Clear all', { variant: 'ghost', size: 'sm', iconName: 'trash', onClick: () => { queue.clear(); renderEmpty(); } })));
    actionBtn = button(cfg.actionLabel, { variant: 'primary', size: 'lg', iconName: cfg.actionIcon || 'zap', onClick: run, className: 'btn-block' });
    actionArea = h('div', { class: 'action-area' }, actionBtn);
    readyEl = h('div', { class: 'tool-layout' },
      h('section', { class: 'tool-main panel', 'aria-label': 'Selected files' },
        listHeader,
        h('p', { class: 'muted small' }, 'Drag the handle (or use the arrows) to set the order.'),
        queue.el,
        more.el),
      h('aside', { class: 'tool-side panel', 'aria-label': 'Options' },
        h('h3', { class: 'panel-title' }, 'Options'),
        options.el,
        messages.el,
        actionArea,
        h('p', { class: 'side-privacy' }, icon('shield', { size: 14 }), h('span', {}, 'Processed locally — never uploaded.'))));
    clear(ctx.root).append(readyEl);
    update();
  }

  function acceptFiles(files) {
    if (busy) return;
    const added = queue.add(files);
    if (!queue.items.length) { renderEmpty(); if (!added) messages.error(`Please choose ${cfg.kind === 'pdf' ? 'PDF files' : 'image files (JPG, PNG, WebP, GIF or BMP)'}.`); return; }
    messages.clear();
    if (!readyEl || !readyEl.isConnected) renderReady();
  }

  function update() {
    if (!readyEl) return;
    if (!queue.items.length) { renderEmpty(); return; }
    const n = queue.items.length;
    countLabel.textContent = `Selected ${noun}s (${n})`;
    if (!busy) {
      actionBtn.disabled = queue.pending || queue.ready.length < cfg.minFiles;
      if (queue.pending) actionBtn.lastChild.textContent = 'Reading files…';
      else actionBtn.lastChild.textContent = cfg.actionLabel;
    }
    if (!queue.pending && queue.ready.length < cfg.minFiles) {
      messages.info(cfg.minFiles > 1 ? `Add at least ${cfg.minFiles} ${noun}s to continue.` : `Add at least one ${noun} to continue.`);
    } else if (queue.hasErrors) {
      messages.warn(`Files marked with an error will be skipped. Remove them or replace them with working copies.`);
    } else {
      messages.clear();
    }
  }

  async function run() {
    if (busy) return;
    await queue.whenIdle();
    let opts;
    try { opts = options.read(); } catch (err) { messages.error(friendlyMessage(err), 'Please check your options'); return; }
    const items = queue.ready;
    if (items.length < cfg.minFiles) { update(); return; }
    busy = true;
    ctx.setBusy(true);
    const bar = progress(cfg.progressLabel || 'Processing...');
    actionArea.replaceChildren(bar.el);
    try {
      const result = await cfg.run({ items, options: opts, progress: bar, signal: ctx.signal });
      if (ctx.signal.aborted) return;
      let preview = null;
      if (result.files.length === 1) {
        try {
          const { blob } = await previewFirstPage(new Uint8Array(await result.files[0].blob.arrayBuffer()), 240);
          preview = h('img', { src: ctx.registry.create(blob), alt: 'Preview of the first page of the result' });
        } catch { /* optional */ }
      }
      const out = result.files[0];
      clear(ctx.root).append(resultPanel({
        files: result.files,
        message: result.message,
        stats: result.stats || [out.name, formatBytes(out.blob.size)],
        preview,
        registry: ctx.registry,
        actions: [
          { label: 'Back to files', iconName: 'arrowLeft', onClick: () => { clear(ctx.root).append(readyEl); actionArea.replaceChildren(actionBtn); update(); } },
          { label: 'Start over', iconName: 'refresh', onClick: () => { queue.clear(); renderEmpty(); } },
        ],
      }));
    } catch (err) {
      if (isAbortError(err)) return;
      logError(ctx.tool.id, err);
      actionArea.replaceChildren(actionBtn);
      messages.error(friendlyMessage(err));
    } finally {
      busy = false;
      ctx.setBusy(false);
      update();
    }
  }

  renderEmpty();
  if (ctx.files?.length) acceptFiles(ctx.files);

  return {
    acceptFiles,
    destroy() { queue.destroy(); },
  };
}

