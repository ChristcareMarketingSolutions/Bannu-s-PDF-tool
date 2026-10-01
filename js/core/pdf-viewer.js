/**
 * PdfViewer — reusable page viewer / organiser component.
 *
 * Two views:
 *   • Grid  – thumbnails with page numbers, selection, rotate, remove,
 *             drag-to-reorder and thumbnail size (zoom) controls.
 *   • Page  – a page strip on the left and a large page on the right with
 *             previous/next navigation and zoom controls.
 *
 * The viewer never modifies the PDF. It keeps a lightweight page model
 *   { id, src, rotation, selected, removed }
 * that tools read with `getPages()` to build their output with pdf-lib.
 *
 * Performance:
 *   • Thumbnails are rendered lazily (IntersectionObserver) through a queue
 *     limited to 2 concurrent renders, so a 2,000-page PDF stays responsive.
 *   • Each thumbnail is stored as a small JPEG Blob URL (not a canvas) and all
 *     URLs plus the PDF.js document are released in `destroy()`.
 */
import { h, clear, announce } from './dom.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { RenderQueue, renderThumbnailBlob, renderPageToCanvas } from './render.js';
import { makeSortable, keyboardMove } from './sortable.js';
import { clamp, plural, releaseCanvas } from './utils.js';
import { isAbortError, logError } from './errors.js';

const THUMB_SIZES = [110, 140, 175, 220];
const FRAME_RATIO = 0.75; // width / height of the thumbnail frame

export class PdfViewer {
  /**
   * @param {object} o
   * @param {any} o.doc          PDF.js document proxy (ownership transferred to the viewer)
   * @param {number} o.numPages
   * @param {{select?:boolean, rotate?:boolean, remove?:boolean, reorder?:boolean}} o.features
   * @param {'all'|'none'} [o.initialSelection]
   * @param {HTMLElement[]} [o.toolbarExtras]  tool-specific buttons for the toolbar
   * @param {(viewer: PdfViewer) => void} [o.onChange]
   */
  constructor({ doc, numPages, features = {}, initialSelection = 'none', toolbarExtras = [], onChange }) {
    this.doc = doc;
    this.numPages = numPages;
    this.features = features;
    this.onChange = onChange;
    this.pages = Array.from({ length: numPages }, (_, i) => ({
      id: `p${i}`, src: i, rotation: 0, selected: initialSelection === 'all', removed: false,
    }));
    this.thumbs = new Map(); // src -> {url, w, h}
    this.queue = new RenderQueue(2);
    this.view = 'grid';
    this.thumbSizeIndex = numPages > 60 ? 1 : 2;
    this.current = 0; // index into this.pages for page view
    this.zoom = { fit: true, scale: 1 };
    this.renderToken = 0;
    this.destroyed = false;

    this.status = h('p', { class: 'viewer-status', 'aria-live': 'polite' });
    this.el = h('div', { class: 'viewer' });
    this.buildToolbar(toolbarExtras);
    this.body = h('div', { class: 'viewer-body' });
    this.el.append(this.body);

    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { root: document.querySelector('.ws-scroll'), rootMargin: '400px 0px' });
    this.renderGrid();
    this.updateStatus();
  }

  /* -------------------------------------------------------------- */
  /* Toolbar                                                        */
  /* -------------------------------------------------------------- */

  buildToolbar(extras) {
    this.gridBtn = h('button', { type: 'button', class: 'view-tab is-active', 'aria-pressed': 'true', onClick: () => this.setView('grid') }, icon('grid', { size: 16 }), h('span', {}, 'Pages'));
    this.pageBtn = h('button', { type: 'button', class: 'view-tab', 'aria-pressed': 'false', onClick: () => this.setView('page') }, icon('page', { size: 16 }), h('span', {}, 'Preview'));
    this.sizeOut = button('Smaller thumbnails', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'zoomOut', onClick: () => this.setThumbSize(-1) });
    this.sizeIn = button('Larger thumbnails', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'zoomIn', onClick: () => this.setThumbSize(1) });
    this.sizeControls = h('div', { class: 'toolbar-group', role: 'group', 'aria-label': 'Thumbnail size' }, this.sizeOut, this.sizeIn);
    this.toolbar = h('div', { class: 'viewer-toolbar' },
      h('div', { class: 'view-tabs', role: 'group', 'aria-label': 'View mode' }, this.gridBtn, this.pageBtn),
      this.sizeControls,
      extras.length ? h('div', { class: 'toolbar-group toolbar-extras' }, extras) : null,
      this.status);
    this.el.append(this.toolbar);
  }

  setThumbSize(delta) {
    this.thumbSizeIndex = clamp(this.thumbSizeIndex + delta, 0, THUMB_SIZES.length - 1);
    this.grid?.style.setProperty('--thumb-size', `${THUMB_SIZES[this.thumbSizeIndex]}px`);
    this.sizeOut.disabled = this.thumbSizeIndex === 0;
    this.sizeIn.disabled = this.thumbSizeIndex === THUMB_SIZES.length - 1;
  }

  setView(view) {
    if (view === this.view) return;
    this.view = view;
    this.gridBtn.classList.toggle('is-active', view === 'grid');
    this.pageBtn.classList.toggle('is-active', view === 'page');
    this.gridBtn.setAttribute('aria-pressed', String(view === 'grid'));
    this.pageBtn.setAttribute('aria-pressed', String(view === 'page'));
    this.sizeControls.hidden = view !== 'grid';
    if (view === 'grid') this.renderGrid();
    else this.renderPageView();
  }

  /* -------------------------------------------------------------- */
  /* Grid view                                                      */
  /* -------------------------------------------------------------- */

  renderGrid() {
    this.teardownView();
    this.grid = h('ul', { class: 'thumb-grid', 'aria-label': 'Pages' });
    this.setThumbSize(0);
    this.pages.forEach((p) => this.grid.append(this.createThumb(p)));
    clear(this.body).append(this.grid);
    if (this.features.reorder) {
      this.sortable = makeSortable(this.grid, {
        itemSelector: '.thumb',
        handleSelector: '.thumb-handle',
        scrollContainer: this.el.closest('.ws-scroll') || document.scrollingElement,
        onEnd: (ids) => this.applyOrder(ids),
      });
    }
  }

  createThumb(p) {
    const f = this.features;
    const label = `Page ${p.src + 1}`;
    const img = h('img', { class: 'thumb-img', alt: '', draggable: 'false', dataset: { src: String(p.src) } });
    const main = h('button', {
      type: 'button',
      class: 'thumb-main',
      onClick: () => this.onThumbActivate(p),
      onDblclick: () => { this.current = this.pages.indexOf(p); this.setView('page'); },
    },
    h('span', { class: 'thumb-frame' },
      h('span', { class: 'thumb-skeleton', 'aria-hidden': 'true' }),
      img,
      f.select ? h('span', { class: 'thumb-check', 'aria-hidden': 'true' }, icon('check', { size: 14, strokeWidth: '3' })) : null,
      f.remove ? h('span', { class: 'thumb-removed', 'aria-hidden': 'true' }, icon('trash', { size: 22 }), h('span', {}, 'Will be removed')) : null));

    const actions = [];
    if (f.rotate) {
      actions.push(button(`Rotate ${label} left`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'rotateLeft', onClick: () => this.rotate(p, -90) }));
      actions.push(button(`Rotate ${label} right`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'rotate', onClick: () => this.rotate(p, 90) }));
    }
    if (f.remove && f.select) {
      actions.push(button(`Remove ${label}`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'trash', onClick: () => this.toggleRemoved(p) }));
    }
    actions.push(button(`Preview ${label}`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'eye', onClick: () => { this.current = this.pages.indexOf(p); this.setView('page'); } }));
    if (f.reorder) {
      const handle = h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon thumb-handle', 'aria-label': `Move ${label}. Use arrow keys to reorder.`, title: 'Drag to reorder' }, icon('grip', { size: 16 }));
      handle.addEventListener('keydown', (e) => {
        const idx = this.pages.indexOf(p);
        const next = keyboardMove(e, idx, this.pages.length);
        if (next < 0) return;
        this.movePage(idx, next);
        this.renderGrid();
        this.grid.querySelector(`[data-id="${p.id}"] .thumb-handle`)?.focus();
        announce(`${label} moved to position ${next + 1} of ${this.pages.length}`);
      });
      actions.push(handle);
    }
    actions.forEach((a) => a.setAttribute('data-no-drag', ''));

    const li = h('li', { class: 'thumb', dataset: { id: p.id } },
      main,
      h('div', { class: 'thumb-bar' }, h('span', { class: 'thumb-num' }, String(p.src + 1)), h('span', { class: 'thumb-actions' }, actions)));
    this.decorateThumb(li, p);
    this.observer.observe(li);
    const cached = this.thumbs.get(p.src);
    if (cached) this.applyThumb(img, cached, li, p);
    return li;
  }

  /** Update classes/ARIA of a thumbnail to reflect its model. */
  decorateThumb(li, p) {
    const main = li.querySelector('.thumb-main');
    const label = `Page ${p.src + 1}`;
    li.classList.toggle('is-selected', !!p.selected);
    li.classList.toggle('is-removed', !!p.removed);
    li.style.setProperty('--rot', `${p.rotation}deg`);
    const cached = this.thumbs.get(p.src);
    li.style.setProperty('--rot-scale', String(this.rotationScale(cached, p.rotation)));
    if (this.features.select) {
      main.setAttribute('aria-pressed', String(!!p.selected));
      main.setAttribute('aria-label', `${label}${p.selected ? ', selected' : ''}${p.rotation ? `, rotated ${p.rotation}°` : ''}`);
    } else if (this.features.remove) {
      main.setAttribute('aria-pressed', String(!!p.removed));
      main.setAttribute('aria-label', `${label}${p.removed ? ', marked for removal' : ''}. Activate to ${p.removed ? 'keep' : 'remove'} this page.`);
    } else {
      main.removeAttribute('aria-pressed');
      main.setAttribute('aria-label', `${label}${p.rotation ? `, rotated ${p.rotation}°` : ''}. Open preview.`);
    }
    const removeBtn = li.querySelector('[aria-label^="Remove"], [aria-label^="Keep"]');
    if (removeBtn) removeBtn.setAttribute('aria-label', `${p.removed ? 'Keep' : 'Remove'} ${label}`);
  }

  /** Scale factor so a 90°/270° rotated thumbnail still fits its frame. */
  rotationScale(thumb, rotation) {
    if (!thumb || rotation % 180 === 0) return 1;
    const { w, h: ht } = thumb;
    const k1 = Math.min(FRAME_RATIO / w, 1 / ht);
    const k2 = Math.min(FRAME_RATIO / ht, 1 / w);
    return (k2 / k1).toFixed(4);
  }

  onThumbActivate(p) {
    if (this.features.select) this.toggleSelected(p);
    else if (this.features.remove) this.toggleRemoved(p);
    else { this.current = this.pages.indexOf(p); this.setView('page'); }
  }

  refreshThumb(p) {
    const li = this.grid?.querySelector(`[data-id="${p.id}"]`);
    if (li) this.decorateThumb(li, p);
  }

  refreshAll() {
    if (this.view === 'grid') this.pages.forEach((p) => this.refreshThumb(p));
    else this.renderPageView();
    this.changed();
  }

  /* -------------------------------------------------------------- */
  /* Lazy thumbnail loading                                         */
  /* -------------------------------------------------------------- */

  onIntersect(entries) {
    for (const entry of entries) {
      const img = entry.target.querySelector('img[data-src]');
      if (!img) continue;
      const src = Number(img.dataset.src);
      if (this.thumbs.has(src)) continue;
      if (entry.isIntersecting) this.requestThumb(src);
      else this.queue.cancel(src);
    }
  }

  requestThumb(src) {
    const width = Math.round(Math.min(2, window.devicePixelRatio || 1) * 190);
    this.queue.add(src, async () => {
      if (this.destroyed) return;
      const { blob, width: w, height: ht } = await renderThumbnailBlob(this.doc, src + 1, width);
      if (this.destroyed) return;
      const thumb = { url: URL.createObjectURL(blob), w, h: ht };
      this.thumbs.set(src, thumb);
      this.el.querySelectorAll(`img[data-src="${src}"]`).forEach((img) => {
        const li = img.closest('.thumb, .strip-item');
        const p = this.pages.find((pg) => pg.src === src);
        this.applyThumb(img, thumb, li, p);
      });
    }).catch((err) => {
      if (isAbortError(err) || this.destroyed) return;
      logError('thumbnail', err);
      this.el.querySelectorAll(`img[data-src="${src}"]`).forEach((img) => img.closest('.thumb, .strip-item')?.classList.add('is-error'));
    });
  }

  applyThumb(img, thumb, li, p) {
    img.src = thumb.url;
    img.closest('.thumb-frame, .strip-frame')?.classList.add('is-loaded');
    if (li && p) li.style.setProperty('--rot-scale', String(this.rotationScale(thumb, p.rotation)));
  }

  /* -------------------------------------------------------------- */
  /* Page view                                                      */
  /* -------------------------------------------------------------- */

  renderPageView() {
    this.teardownView();
    this.current = clamp(this.current, 0, this.pages.length - 1);
    const strip = h('ol', { class: 'page-strip', 'aria-label': 'Page list' });
    this.pages.forEach((p, i) => {
      const img = h('img', { alt: '', draggable: 'false', dataset: { src: String(p.src) } });
      const item = h('li', { class: `strip-item${i === this.current ? ' is-current' : ''}${p.removed ? ' is-removed' : ''}${p.selected ? ' is-selected' : ''}`, style: { '--rot': `${p.rotation}deg`, '--rot-scale': String(this.rotationScale(this.thumbs.get(p.src), p.rotation)) } },
        h('button', { type: 'button', class: 'strip-btn', 'aria-label': `Go to page ${p.src + 1}`, 'aria-current': i === this.current ? 'page' : undefined, onClick: () => this.goTo(i) },
          h('span', { class: 'strip-frame' }, img),
          h('span', { class: 'strip-num' }, String(p.src + 1))));
      strip.append(item);
      this.observer.observe(item);
      const cached = this.thumbs.get(p.src);
      if (cached) this.applyThumb(img, cached, item, p);
    });

    const p = this.pages[this.current];
    this.pageLabel = h('span', { class: 'page-indicator', 'aria-live': 'polite' });
    this.zoomLabel = h('span', { class: 'zoom-indicator' });
    const actions = [];
    if (this.features.rotate) {
      actions.push(button('Rotate page left', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'rotateLeft', onClick: () => this.rotate(this.pages[this.current], -90) }));
      actions.push(button('Rotate page right', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'rotate', onClick: () => this.rotate(this.pages[this.current], 90) }));
    }
    if (this.features.select) {
      actions.push(button(p.selected ? 'Deselect page' : 'Select page', { variant: p.selected ? 'primary' : 'secondary', size: 'sm', iconName: 'check', onClick: () => this.toggleSelected(this.pages[this.current]) }));
    }
    if (this.features.remove && !this.features.select) {
      actions.push(button(p.removed ? 'Keep page' : 'Remove page', { variant: p.removed ? 'primary' : 'secondary', size: 'sm', iconName: 'trash', onClick: () => this.toggleRemoved(this.pages[this.current]) }));
    }

    this.stageCanvasHost = h('div', { class: 'stage-canvas' });
    this.stage = h('div', { class: 'page-stage-scroll', tabindex: '0', 'aria-label': 'Page preview. Use arrow keys to change page.' }, this.stageCanvasHost);
    this.stage.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); this.goTo(this.current + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.goTo(this.current - 1); }
      if (e.key === '+' || e.key === '=') this.setZoom(this.currentScale() * 1.25);
      if (e.key === '-') this.setZoom(this.currentScale() / 1.25);
    });
    const stageBar = h('div', { class: 'stage-bar' },
      h('div', { class: 'toolbar-group' },
        button('Previous page', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'chevronLeft', onClick: () => this.goTo(this.current - 1) }),
        this.pageLabel,
        button('Next page', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'chevronRight', onClick: () => this.goTo(this.current + 1) })),
      h('div', { class: 'toolbar-group' },
        button('Zoom out', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'zoomOut', onClick: () => this.setZoom(this.currentScale() / 1.25) }),
        this.zoomLabel,
        button('Zoom in', { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'zoomIn', onClick: () => this.setZoom(this.currentScale() * 1.25) }),
        button('Fit to width', { variant: 'ghost', size: 'sm', onClick: () => { this.zoom.fit = true; this.renderStage(); } })),
      actions.length ? h('div', { class: 'toolbar-group' }, actions) : null);

    this.pageView = h('div', { class: 'page-view' }, strip, h('div', { class: 'page-stage' }, stageBar, this.stage));
    clear(this.body).append(this.pageView);
    this.strip = strip;
    strip.children[this.current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.zoom.fit) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.renderStage(), 120);
    });
    this.resizeObserver.observe(this.stage);
    this.renderStage();
  }

  goTo(index) {
    if (index < 0 || index >= this.pages.length) return;
    this.current = index;
    this.renderPageView();
    this.stage.focus({ preventScroll: true });
  }

  currentScale() { return this.zoom.scale || 1; }

  setZoom(scale) {
    this.zoom = { fit: false, scale: clamp(scale, 0.25, 4) };
    this.renderStage();
  }

  async renderStage() {
    if (!this.stage || this.destroyed) return;
    const token = ++this.renderToken;
    const p = this.pages[this.current];
    this.pageLabel.textContent = `${this.current + 1} / ${this.pages.length}`;
    try {
      const page = await this.doc.getPage(p.src + 1);
      const totalRotation = (page.rotate + p.rotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: totalRotation });
      if (this.zoom.fit) {
        const avail = Math.max(120, this.stage.clientWidth - 32);
        this.zoom.scale = clamp(avail / base.width, 0.25, 4);
      }
      this.zoomLabel.textContent = `${Math.round(this.zoom.scale * 100)}%`;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { canvas } = await renderPageToCanvas(this.doc, p.src + 1, { scale: this.zoom.scale * dpr, rotation: p.rotation });
      if (token !== this.renderToken || this.destroyed) { releaseCanvas(canvas); return; }
      canvas.style.width = `${Math.round(canvas.width / dpr)}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Page ${p.src + 1}${p.rotation ? `, rotated ${p.rotation}°` : ''}${p.removed ? ', marked for removal' : ''}`);
      canvas.classList.toggle('is-removed', !!p.removed);
      const old = this.stageCanvasHost.querySelector('canvas');
      this.stageCanvasHost.replaceChildren(canvas);
      releaseCanvas(old);
    } catch (err) {
      if (token !== this.renderToken) return;
      logError('render page', err);
      this.stageCanvasHost.replaceChildren(h('p', { class: 'stage-error' }, "This page couldn't be displayed. It may be damaged, but you can still process the document."));
    }
  }

  /* -------------------------------------------------------------- */
  /* Model operations                                               */
  /* -------------------------------------------------------------- */

  toggleSelected(p, value = !p.selected) {
    p.selected = value;
    if (this.view === 'grid') this.refreshThumb(p); else this.renderPageView();
    this.changed();
  }

  toggleRemoved(p) {
    const keep = this.pages.filter((x) => !x.removed).length;
    if (!p.removed && keep <= 1) {
      announce('At least one page must remain.');
      this.onChange?.(this, { warning: 'At least one page must remain in the document.' });
      return;
    }
    p.removed = !p.removed;
    if (this.view === 'grid') this.refreshThumb(p); else this.renderPageView();
    announce(`Page ${p.src + 1} ${p.removed ? 'marked for removal' : 'kept'}`);
    this.changed();
  }

  rotate(p, delta) {
    p.rotation = (((p.rotation + delta) % 360) + 360) % 360;
    if (this.view === 'grid') this.refreshThumb(p); else this.renderPageView();
    announce(`Page ${p.src + 1} rotated to ${p.rotation}°`);
    this.changed();
  }

  rotateAll(delta, onlySelected = false) {
    this.pages.forEach((p) => {
      if (!onlySelected || p.selected) p.rotation = (((p.rotation + delta) % 360) + 360) % 360;
    });
    this.refreshAll();
  }

  movePage(from, to) {
    const [p] = this.pages.splice(from, 1);
    this.pages.splice(to, 0, p);
    this.changed();
  }

  applyOrder(ids) {
    const byId = new Map(this.pages.map((p) => [p.id, p]));
    this.pages = ids.map((id) => byId.get(id)).filter(Boolean);
    announce('Page order updated');
    this.changed();
  }

  setSelection(predicate) {
    this.pages.forEach((p, i) => { p.selected = !!predicate(p, i); });
    this.refreshAll();
  }

  selectAll() { this.setSelection(() => true); }
  selectNone() { this.setSelection(() => false); }
  invertSelection() { this.setSelection((p) => !p.selected); }

  /** Select by original 0-based page indexes. */
  selectSources(indexes) {
    const set = new Set(indexes);
    this.setSelection((p) => set.has(p.src));
  }

  markRemovedSources(indexes) {
    const set = new Set(indexes);
    if (this.pages.every((p) => set.has(p.src))) return false;
    this.pages.forEach((p) => { p.removed = set.has(p.src); });
    this.refreshAll();
    return true;
  }

  reverse() {
    this.pages.reverse();
    this.view === 'grid' ? this.renderGrid() : this.renderPageView();
    this.changed();
  }

  reset() {
    this.pages.sort((a, b) => a.src - b.src);
    this.pages.forEach((p) => { p.rotation = 0; p.removed = false; });
    this.view === 'grid' ? this.renderGrid() : this.renderPageView();
    this.changed();
  }

  /** Snapshot of the page model in display order. */
  getPages() {
    return this.pages.map((p) => ({ ...p }));
  }

  selectedSources() {
    return this.pages.filter((p) => p.selected).map((p) => p.src);
  }

  isModified() {
    return this.pages.some((p, i) => p.src !== i || p.rotation !== 0 || p.removed);
  }

  changed() {
    this.updateStatus();
    this.onChange?.(this);
  }

  updateStatus() {
    const total = this.pages.length;
    const parts = [plural(total, 'page')];
    if (this.features.select) parts.push(`${this.pages.filter((p) => p.selected).length} selected`);
    if (this.features.remove && !this.features.select) {
      const r = this.pages.filter((p) => p.removed).length;
      if (r) parts.push(`${r} to remove`);
    }
    if (this.features.rotate) {
      const r = this.pages.filter((p) => p.rotation).length;
      if (r) parts.push(`${r} rotated`);
    }
    this.status.textContent = parts.join(' · ');
  }

  /* -------------------------------------------------------------- */
  /* Cleanup                                                        */
  /* -------------------------------------------------------------- */

  teardownView() {
    this.sortable?.destroy();
    this.sortable = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observer?.disconnect();
    this.renderToken++;
    const canvas = this.stageCanvasHost?.querySelector('canvas');
    releaseCanvas(canvas);
    this.stage = null;
    this.grid = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardownView();
    this.queue.destroy();
    this.thumbs.forEach((t) => URL.revokeObjectURL(t.url));
    this.thumbs.clear();
    try { this.doc?.destroy(); } catch { /* ignore */ }
    this.doc = null;
    this.el.remove();
  }
}
