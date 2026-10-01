/**
 * Lightweight drag-to-reorder for lists and grids using Pointer Events,
 * so it works with mouse, touch and pen (HTML5 drag-and-drop does not work
 * on mobile browsers).
 *
 *  • Mouse: drag the whole item (except elements marked [data-no-drag]).
 *  • Touch/pen: drag using the item's handle, so normal scrolling still works.
 *  • Keyboard: focus the handle and use the arrow keys (see `keyboardMove`).
 *
 * The DOM is reordered live; `onEnd(orderedIds)` fires once the drag ends.
 */
export function makeSortable(container, { itemSelector, handleSelector, scrollContainer, onEnd }) {
  let drag = null;
  let rafId = 0;

  const items = () => [...container.querySelectorAll(itemSelector)];
  const order = () => items().map((el) => el.dataset.id);

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    const onHandle = !!e.target.closest(handleSelector);
    if (!onHandle) {
      if (e.pointerType !== 'mouse') return;
      if (e.target.closest('[data-no-drag], input, select, textarea, a')) return;
    }
    drag = { item, pointerId: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, startOrder: order().join('|') };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag.active = true;
      drag.item.classList.add('is-dragging');
      container.classList.add('is-sorting');
      document.body.classList.add('is-sorting');
      autoScroll();
    }
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(itemSelector);
    if (!target || target === drag.item || !container.contains(target)) return;
    const list = items();
    const from = list.indexOf(drag.item);
    const to = list.indexOf(target);
    if (from < to) target.after(drag.item);
    else target.before(drag.item);
  }

  function onPointerUp() {
    if (!drag) return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    cancelAnimationFrame(rafId);
    if (drag.active) {
      drag.item.classList.remove('is-dragging');
      container.classList.remove('is-sorting');
      document.body.classList.remove('is-sorting');
      // Swallow the click that follows a drag so it doesn't toggle selection.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
      const newOrder = order();
      if (newOrder.join('|') !== drag.startOrder) onEnd?.(newOrder, drag.item);
    }
    drag = null;
  }

  /** Scroll the container while dragging near its top/bottom edge. */
  function autoScroll() {
    const scroller = scrollContainer || container;
    const step = () => {
      if (!drag?.active) return;
      const rect = scroller.getBoundingClientRect();
      const edge = 48;
      let dy = 0;
      if (drag.y < rect.top + edge) dy = -Math.ceil((rect.top + edge - drag.y) / 4);
      else if (drag.y > rect.bottom - edge) dy = Math.ceil((drag.y - (rect.bottom - edge)) / 4);
      if (dy) scroller.scrollTop += dy;
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  container.addEventListener('pointerdown', onPointerDown);
  // Prevent native image dragging from hijacking the gesture.
  container.addEventListener('dragstart', (e) => { if (e.target.closest?.(itemSelector)) e.preventDefault(); });

  return {
    destroy() {
      container.removeEventListener('pointerdown', onPointerDown);
      onPointerUp();
    },
  };
}

/**
 * Keyboard reordering helper: call from a keydown handler on an item's handle.
 * Returns the new index if the key moved the item, otherwise -1.
 */
export function keyboardMove(e, index, length) {
  const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  if (!back && !fwd) return -1;
  e.preventDefault();
  const next = back ? index - 1 : index + 1;
  if (next < 0 || next >= length) return -1;
  return next;
}
