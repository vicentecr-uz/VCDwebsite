function heightAnimation(panel) {
  return panel.getAnimations().find((animation) => {
    const keyframes = animation.effect?.getKeyframes?.() ?? [];
    return keyframes.length > 1 && keyframes.some((frame) => frame.height != null);
  }) ?? null;
}
const px = (value) => Number.parseFloat(value) || 0;
export function mount(panels = [...document.querySelectorAll('[data-dev-overlay]:not([data-embedded])')]) {
  const tracked = new Map();
  const cancel = (panel) => { const state = tracked.get(panel); if (!state) return; state.mask.cancel(); tracked.delete(panel); state.body.style.clipPath = state.originalClipPath; };
  const sync = (panel) => {
    const body = panel.querySelector('[data-overlay-body]'); const source = panel.classList.contains('is-dev-overlay-morphing') ? heightAnimation(panel) : null;
    if (!body || !source) { cancel(panel); return; } if (tracked.get(panel)?.source === source) return; cancel(panel);
    const frames = source.effect?.getKeyframes?.() ?? []; const from = px(frames[0]?.height); const to = px(frames.at(-1)?.height); if (from === to) return;
    const panelRect = panel.getBoundingClientRect(); const bodyRect = body.getBoundingClientRect(); const bodyHeight = bodyRect.height; const bodyTop = bodyRect.top - panelRect.top; const paddingBottom = px(getComputedStyle(panel).paddingBottom); const styles = getComputedStyle(body); const corners = `${styles.borderBottomLeftRadius} ${styles.borderBottomRightRadius}`;
    const inset = (height) => `${Math.max(0, bodyHeight - Math.min(bodyHeight, Math.max(0, height - bodyTop - paddingBottom)))}px`; const timing = source.effect?.getTiming?.() ?? {};
    const mask = body.animate([{ clipPath: `inset(0 0 ${inset(from)} 0 round 0 0 ${corners})` }, { clipPath: `inset(0 0 ${inset(to)} 0 round 0 0 ${corners})` }], { duration: timing.duration, easing: timing.easing, fill: timing.fill });
    const state = { source, mask, body, originalClipPath: body.style.clipPath }; tracked.set(panel, state);
    source.ready.then(() => { if (tracked.get(panel) !== state || !panel.classList.contains('is-dev-overlay-morphing')) { mask.cancel(); return; } if (source.startTime != null) mask.startTime = source.startTime; else if (source.currentTime != null) mask.currentTime = source.currentTime; }).catch(() => {});
  };
  const observers = panels.map((panel) => { const observer = new MutationObserver(() => sync(panel)); observer.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] }); sync(panel); return observer; });
  return () => { observers.forEach((observer) => observer.disconnect()); panels.forEach(cancel); };
}
