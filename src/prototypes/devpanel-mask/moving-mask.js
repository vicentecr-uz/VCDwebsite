const DURATION = 250;
const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
const px = (value) => Number.parseFloat(value) || 0;

function heightAnimation(panel) {
  return panel.getAnimations().find((animation) => {
    const keyframes = animation.effect?.getKeyframes?.() ?? [];
    return keyframes.length > 1 && keyframes.some((frame) => frame.height != null);
  }) ?? null;
}
function keyframeHeight(frame, fallback) { const value = typeof frame.height === 'number' ? frame.height : px(frame.height); return Number.isFinite(value) ? value : fallback; }
function radius(body) { const styles = getComputedStyle(body); return `${styles.borderBottomLeftRadius} ${styles.borderBottomRightRadius}`; }

export function mount() {
  const tracked = new Map(); let disposed = false;
  const cancel = (panel) => { const current = tracked.get(panel); if (!current) return; current.generation += 1; current.mask?.cancel(); tracked.delete(panel); current.body.style.removeProperty('clip-path'); };
  const sync = (panel) => {
    if (disposed) return;
    const body = panel.querySelector('[data-overlay-body]');
    if (!body || !panel.classList.contains('is-dev-overlay-morphing')) { cancel(panel); return; }
    const source = heightAnimation(panel); const existing = tracked.get(panel);
    if (!source || (existing && existing.source === source)) return;
    cancel(panel);
    const keyframes = source.effect?.getKeyframes?.() ?? []; const panelRect = panel.getBoundingClientRect(); const bodyRect = body.getBoundingClientRect();
    const bodyHeight = bodyRect.height; const bodyTop = bodyRect.top - panelRect.top; const paddingBottom = px(getComputedStyle(panel).paddingBottom); const corners = radius(body);
    const first = keyframeHeight(keyframes[0], panelRect.height); const last = keyframeHeight(keyframes[keyframes.length - 1], panelRect.height);
    if (first === last) { body.style.removeProperty('clip-path'); return; }
    const visible = (height) => Math.min(bodyHeight, Math.max(0, height - bodyTop - paddingBottom)); const inset = (height) => `${Math.max(0, bodyHeight - visible(height))}px`;
    const mask = body.animate([{ clipPath: `inset(0 0 ${inset(first)} 0 round 0 0 ${corners})` }, { clipPath: `inset(0 0 ${inset(last)} 0 round 0 0 ${corners})` }], { duration: DURATION, easing: EASING, fill: 'both' });
    const state = { source, mask, body }; tracked.set(panel, state);
    source.ready.then(() => {
      if (disposed || tracked.get(panel) !== state || !panel.classList.contains('is-dev-overlay-morphing')) { mask.cancel(); return; }
      const timing = source.effect?.getTiming?.();
      if (timing?.duration === 0 || source.playState === 'idle') { mask.cancel(); body.style.removeProperty('clip-path'); return; }
      if (source.startTime != null) mask.startTime = source.startTime; else if (source.currentTime != null) mask.currentTime = source.currentTime;
    }).catch(() => {});
  };
  const panels = [...document.querySelectorAll('[data-dev-overlay]:not([data-embedded])')]; const observers = [];
  const observe = (panel) => { const observer = new MutationObserver(() => sync(panel)); observer.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] }); observers.push(observer); sync(panel); };
  panels.forEach(observe);
  const panelObserver = new MutationObserver(() => document.querySelectorAll('[data-dev-overlay]:not([data-embedded])').forEach((panel) => { if (!panels.includes(panel)) { panels.push(panel); observe(panel); } }));
  panelObserver.observe(document.body, { childList: true, subtree: true });
  return () => { disposed = true; panelObserver.disconnect(); observers.forEach((observer) => observer.disconnect()); panels.forEach(cancel); };
}
