export const selected = ':scope > .dev-btn:is(.is-active, .is-selected, [aria-pressed="true"])';
const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: no-preference)') : null;

const LEAD = { visualDuration: 250, bounce: 0 };
const TRAIL = { visualDuration: 400, bounce: 0.2 };
const STEP = 10;
const REST_DELTA = 0.1;
const REST_SPEED = 2;

const spring = ({ visualDuration, bounce }: typeof LEAD) => {
  const w = (2 * Math.PI) / ((visualDuration / 1000) * 1.2);
  const z = Math.max(1 - bounce, 0.05);
  if (z >= 1) {
    return (t: number, delta: number) => {
      const e = Math.exp(-w * t);
      return [delta - e * delta * (1 + w * t), delta * w * w * t * e];
    };
  }
  const wd = w * Math.sqrt(1 - z * z);
  return (t: number, delta: number) => {
    const e = Math.exp(-z * w * t);
    return [
      delta - e * delta * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t)),
      delta * (w / Math.sqrt(1 - z * z)) * e * Math.sin(wd * t),
    ];
  };
};
const lead = spring(LEAD);
const trail = spring(TRAIL);
const resting = (edge: typeof lead, delta: number, ms: number) => {
  const [x, v] = edge(ms / 1000, delta);
  return Math.abs(delta - x) <= REST_DELTA && Math.abs(v) <= REST_SPEED;
};

const box = (el: Element, group: HTMLElement) => {
  const r = el.getBoundingClientRect();
  const g = group.getBoundingClientRect();
  const scale = (group.offsetWidth && g.width / group.offsetWidth) || 1;
  const style = getComputedStyle(el);
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  return {
    left: (r.left + r.width / 2 - g.left) / scale - width / 2 - group.clientLeft,
    top: (r.top + r.height / 2 - g.top) / scale - height / 2 - group.clientTop,
    width,
    height,
  };
};

const pending = new WeakMap<Element, number>();
const flights = new WeakMap<Element, { edges: Array<[number, number]>; animation: Animation }>();

export function slideSelection(group: HTMLElement, previous: HTMLElement) {
  if (pending.has(group) || !motion?.matches) return;
  const oldPill = group.querySelector<HTMLElement>(':scope > .dev-segmented__indicator');
  const flight = oldPill && previous.hasAttribute('data-segment-target') ? flights.get(oldPill) : undefined;
  const prev = box(previous, group);
  let from = { left: prev.left, right: prev.left + prev.width };
  if (flight && flight.animation.playState === 'running') {
    const progress = Number(flight.animation.currentTime) / Number(flight.animation.effect!.getTiming().duration);
    const [left, right] = flight.edges[Math.min(flight.edges.length - 1, Math.round(progress * (flight.edges.length - 1)))];
    from = { left, right };
  }

  pending.set(group, requestAnimationFrame(() => {
    pending.delete(group);
    const [next, extra] = group.querySelectorAll<HTMLButtonElement>(selected);
    if (!next || next === previous || extra || !motion?.matches || !next.offsetWidth
      || previous.offsetTop !== next.offsetTop || previous.offsetHeight !== next.offsetHeight) return;

    oldPill?.remove();
    group.querySelector(':scope > [data-segment-target]')?.removeAttribute('data-segment-target');

    const target = box(next, group);
    const span = group.clientWidth;
    const pill = document.createElement('span');
    const fill = document.createElement('span');
    pill.className = 'dev-segmented__indicator';
    pill.setAttribute('aria-hidden', 'true');
    pill.append(fill);
    Object.assign(pill.style, { width: `${span}px`, height: `${target.height}px` });
    next.setAttribute('data-segment-target', '');
    group.prepend(pill);

    const to = { left: target.left, right: target.left + target.width };
    const rightward = to.left > from.left;
    const leftSpring = rightward ? trail : lead;
    const rightSpring = rightward ? lead : trail;
    const dl = to.left - from.left;
    const dr = to.right - from.right;
    const edges: Array<[number, number]> = [];
    let t = 0;
    for (; t < 3000 && !(resting(leftSpring, dl, t) && resting(rightSpring, dr, t)); t += STEP) edges.push([from.left + leftSpring(t / 1000, dl)[0], from.right + rightSpring(t / 1000, dr)[0]]);
    edges.push([to.left, to.right]);

    const timing = { duration: t + STEP, easing: 'linear', fill: 'forwards' } as const;
    const animation = pill.animate(edges.map(([, right]) => ({ transform: `translate(${right - span}px, ${target.top}px)` })), timing);
    fill.animate(edges.map(([left, right]) => ({ transform: `translateX(${Math.min(left, right) - right + span}px)` })), timing);
    flights.set(pill, { edges, animation });
    animation.onfinish = () => {
      if (pill.parentElement !== group) return;
      pill.remove();
      next.removeAttribute('data-segment-target');
    };
  }));
}

export function cancelSlide(group: HTMLElement) {
  const frame = pending.get(group);
  if (frame !== undefined) cancelAnimationFrame(frame);
  pending.delete(group);
}
