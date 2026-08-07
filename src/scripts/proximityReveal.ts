/**
 * Reveal a control only when the pointer looks like it is going for it.
 *
 * Two signals, both required: the pointer is near the target's centre, and it
 * has slowed down. Sweeping the cursor across a grid on the way somewhere else
 * crosses plenty of centres at speed and must summon nothing.
 *
 * Once shown, the control holds inside a wider ring and ignores speed entirely —
 * reaching for a button that just appeared is a fast movement, and hiding it
 * out from under that reach is the failure this whole gate exists to avoid.
 */

import { smoothToward } from './sectionReorder';

export const PROXIMITY_REVEAL = {
  /** Reveal radius as a share of the target's short side. */
  RADIUS_RATIO: 0.3,
  MIN_RADIUS_PX: 48,
  MAX_RADIUS_PX: 96,
  /** Shown controls hold out to this multiple of the reveal radius. */
  HOLD_RADIUS_SCALE: 1.7,
  /** px/ms. Above this the pointer is passing through, not looking. */
  SEEK_SPEED: 0.45,
  SPEED_SMOOTHING: 0.35,
  /** Slow and near for this long before anything appears. */
  DWELL_MS: 90,
  /** Grace before hiding, so a wobble at the edge of the ring doesn't flicker. */
  HIDE_DELAY_MS: 140,
} as const;

export type ProximityReveal = {
  /** Stop tracking and pin the current reveal (used while a drag owns it). */
  hold: () => void;
  release: () => void;
  /** Drop the reveal immediately — dev mode exit, pointer leaving the window. */
  clear: () => void;
  destroy: () => void;
};

export const createProximityReveal = (options: {
  getTargets: () => HTMLElement[];
  /** Called when the revealed target changes. `null` means nothing is revealed. */
  setRevealed: (target: HTMLElement | null) => void;
  isEnabled: () => boolean;
  tuning?: Partial<typeof PROXIMITY_REVEAL>;
}): ProximityReveal => {
  const config = { ...PROXIMITY_REVEAL, ...options.tuning };

  let revealed: HTMLElement | null = null;
  let speed = 0;
  let lastX: number | null = null;
  let lastY: number | null = null;
  let lastTime = 0;
  let held = false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelDwell = () => {
    if (!dwellTimer) return;
    clearTimeout(dwellTimer);
    dwellTimer = null;
  };

  const cancelHide = () => {
    if (!hideTimer) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const setRevealed = (target: HTMLElement | null) => {
    if (revealed === target) return;
    revealed = target;
    options.setRevealed(target);
  };

  const clear = () => {
    cancelDwell();
    cancelHide();
    setRevealed(null);
  };

  const scheduleHide = () => {
    if (!revealed || hideTimer) return;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      setRevealed(null);
    }, config.HIDE_DELAY_MS);
  };

  const radiusFor = (rect: DOMRect) => Math.min(
    config.MAX_RADIUS_PX,
    Math.max(config.MIN_RADIUS_PX, Math.min(rect.width, rect.height) * config.RADIUS_RATIO),
  );

  const distanceToCentre = (target: HTMLElement, x: number, y: number) => {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      distance: Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2)),
      radius: radiusFor(rect),
    };
  };

  const nearestTarget = (x: number, y: number, scale: number) => {
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    options.getTargets().forEach((target) => {
      const measured = distanceToCentre(target, x, y);
      if (!measured) return;
      if (measured.distance > measured.radius * scale) return;
      if (measured.distance >= bestDistance) return;
      best = target;
      bestDistance = measured.distance;
    });
    return best;
  };

  const stillHolding = (x: number, y: number) => {
    if (!revealed || !revealed.isConnected) return false;
    const measured = distanceToCentre(revealed, x, y);
    if (!measured) return false;
    return measured.distance <= measured.radius * config.HOLD_RADIUS_SCALE;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (held) return;
    if (!options.isEnabled()) {
      clear();
      return;
    }
    // Touch has no hover state to read intent from; a tap is the whole gesture.
    if (event.pointerType === 'touch') return;

    const now = event.timeStamp || performance.now();
    const x = event.clientX;
    const y = event.clientY;

    if (lastX !== null && lastY !== null) {
      const dtMs = Math.max(1, Math.min(100, now - lastTime));
      const instant = Math.hypot(x - lastX, y - lastY) / dtMs;
      speed = smoothToward(speed, instant, dtMs, config.SPEED_SMOOTHING);
    }
    lastX = x;
    lastY = y;
    lastTime = now;

    if (stillHolding(x, y)) {
      cancelHide();
      cancelDwell();
      return;
    }

    const near = nearestTarget(x, y, 1);
    if (!near) {
      cancelDwell();
      scheduleHide();
      return;
    }

    if (near === revealed) {
      cancelHide();
      return;
    }

    if (speed > config.SEEK_SPEED) {
      cancelDwell();
      scheduleHide();
      return;
    }

    if (dwellTimer) return;
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      // Re-check on landing: the pointer has moved on since the timer was set.
      if (held || !options.isEnabled()) return;
      if (lastX === null || lastY === null) return;
      const still = nearestTarget(lastX, lastY, 1);
      if (!still || speed > config.SEEK_SPEED) return;
      cancelHide();
      setRevealed(still);
    }, config.DWELL_MS);
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (held) return;
    if (event.relatedTarget !== null) return;
    clear();
    speed = 0;
    lastX = null;
    lastY = null;
  };

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerout', onPointerLeave, { passive: true });

  return {
    hold: () => {
      held = true;
      cancelDwell();
      cancelHide();
    },
    release: () => {
      held = false;
      speed = 0;
    },
    clear,
    destroy: () => {
      clear();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerLeave);
    },
  };
};
