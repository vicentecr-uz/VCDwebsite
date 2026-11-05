// Scroll fade for code blocks capped to a number of lines (ProjectCodeBlock maxLines). Each edge
// fades in proportion to how much is hidden past it, up to one fade length, as Sabi does
// horizontally (src/lib/sabi/core.ts #syncFades). Replace with Sabi once it supports multi-line text.

const FADE_EM = 2.5;

function sync(scroller: HTMLElement) {
  const hidden = scroller.scrollHeight - scroller.clientHeight;
  if (hidden <= 1) {
    scroller.removeAttribute('data-code-scroll');
    return;
  }
  const fade = FADE_EM * parseFloat(getComputedStyle(scroller).fontSize);
  scroller.setAttribute('data-code-scroll', '');
  scroller.style.setProperty('--code-fade-top', String(Math.min(1, scroller.scrollTop / fade)));
  scroller.style.setProperty('--code-fade-bottom', String(Math.min(1, (hidden - scroller.scrollTop) / fade)));
}

const observer = new ResizeObserver((entries) => entries.forEach((entry) => sync(entry.target as HTMLElement)));

function bind(scroller: HTMLElement) {
  if (scroller.dataset.codeScrollBound) return;
  scroller.dataset.codeScrollBound = '';
  scroller.addEventListener('scroll', () => sync(scroller), { passive: true });
  observer.observe(scroller);
  sync(scroller);
}

export function syncCodeBlock(root: Element) {
  root.querySelectorAll<HTMLElement>('.astro-code').forEach((scroller) => {
    bind(scroller);
    sync(scroller);
  });
}

document.querySelectorAll('[data-code-block]').forEach(syncCodeBlock);
