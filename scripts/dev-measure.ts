
type Box = { top: number; right: number; bottom: number; left: number };
type Fragment = Box & { text: string; baseline: number; capTop: number; block: Box; node: Element };

const canvas = document.createElement('canvas').getContext('2d')!;

const fontMetrics = (style: CSSStyleDeclaration) => {
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const line = canvas.measureText('Hxg');
  return { ascent: line.fontBoundingBoxAscent, cap: canvas.measureText('H').actualBoundingBoxAscent };
};

const visible = (el: Element) => {
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && Number(style.opacity) > 0 && style.display !== 'none';
};

const hasPaint = (el: Element) => {
  if (/^(IMG|svg|CANVAS|VIDEO)$/.test(el.tagName)) return true;
  const style = getComputedStyle(el);
  const bg = style.backgroundColor;
  return (bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) || style.backgroundImage !== 'none'
    || ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width` as 'borderTopWidth']) > 0 && style[`border${side}Style` as 'borderTopStyle'] !== 'none')
    || style.boxShadow !== 'none';
};

const blockOf = (el: Element): Box => {
  let block: Element = el;
  while (block.parentElement && /^(inline|contents)$/.test(getComputedStyle(block).display)) block = block.parentElement;
  const { top, right, bottom, left } = block.getBoundingClientRect();
  return { top, right, bottom, left };
};

export const textFragments = (container: Element): Fragment[] => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const fragments: Fragment[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent?.trim() || !parent || !visible(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const { ascent, cap } = fontMetrics(getComputedStyle(parent));
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const baseline = rect.top + ascent;
      fragments.push({ text: node.textContent.trim().slice(0, 24), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, baseline, capTop: baseline - cap, block: blockOf(parent), node: parent });
    }
  }
  return fragments;
};

const round = (n: number) => Math.round(n * 10) / 10;

const describe = (el: Element) => {
  const cls = [...el.classList].filter((c) => !c.startsWith('is-')).slice(0, 2).join('.');
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
};

const innerBox = (panel: Element): Box => {
  const outer = panel.getBoundingClientRect();
  const top = outer.top + panel.clientTop;
  const left = outer.left + panel.clientLeft;
  return { top, left, right: left + panel.clientWidth, bottom: top + panel.clientHeight };
};

const overlaps = (a: Box, b: Box) => a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;

export const insets = (panel: Element, mode: 'box' | 'ink' = 'box') => {
  const inner = innerBox(panel);
  const sides = { top: Infinity, right: Infinity, bottom: Infinity, left: Infinity };
  const by: Record<keyof typeof sides, string> = { top: '', right: '', bottom: '', left: '' };
  const add = (box: Box, el: Element) => {
    if (!overlaps(box, inner)) return;
    const distances = { top: box.top - inner.top, right: inner.right - box.right, bottom: inner.bottom - box.bottom, left: box.left - inner.left };
    for (const side of Object.keys(sides) as Array<keyof typeof sides>) {
      const d = Math.max(0, distances[side]);
      if (d < sides[side]) { sides[side] = d; by[side] = describe(el); }
    }
  };
  panel.querySelectorAll('*').forEach((el) => {
    if (!visible(el) || !hasPaint(el) || el.closest('[aria-hidden="true"]')) return;
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.height) add(rect, el);
  });
  textFragments(panel).forEach((f) => add(mode === 'box' ? { ...f.block, left: f.left, right: f.right } : { top: f.capTop, bottom: f.baseline, left: f.left, right: f.right }, f.node));
  const rounded = { top: round(sides.top), right: round(sides.right), bottom: round(sides.bottom), left: round(sides.left) };
  const values = Object.values(rounded);
  return { ...rounded, by, equal: Math.max(...values) - Math.min(...values) <= 0.5 };
};

export const rows = (container: Element) => {
  const inner = innerBox(container);
  const fragments = textFragments(container).filter((f) => overlaps(f, inner)).sort((a, b) => a.capTop - b.capTop);
  const groups: Fragment[][] = [];
  for (const f of fragments) {
    const row = groups.find((g) => g.some((o) => f.capTop < o.baseline && o.capTop < f.baseline && (f.left >= o.right || o.left >= f.right)));
    row ? row.push(f) : groups.push([f]);
  }
  return groups.filter((g) => g.length > 1).map((g) => {
    const baselines = g.map((f) => f.baseline);
    const spread = round(Math.max(...baselines) - Math.min(...baselines));
    return { texts: g.sort((a, b) => a.left - b.left).map((f) => `${f.text} @${round(f.baseline)}`), spread, aligned: spread <= 0.5 };
  });
};

export const report = (selector: string) => {
  const panel = document.querySelector(selector);
  if (!panel) return `No element matches ${selector}`;
  if (!panel.getBoundingClientRect().height) return `${selector} is not rendered; open the panel first`;
  const line = (mode: 'box' | 'ink') => {
    const i = insets(panel, mode);
    const side = (name: 'top' | 'right' | 'bottom' | 'left') => `${name} ${i[name]} (${i.by[name]})`;
    return `${mode} insets  ${i.equal ? 'equal' : 'UNEQUAL'}\n  ${side('top')}\n  ${side('right')}\n  ${side('bottom')}\n  ${side('left')}`;
  };
  const lines = [line('box'), line('ink')];
  for (const row of rows(panel)) lines.push(`row  ${row.aligned ? 'aligned' : `BASELINES DIFFER by ${row.spread}px`}  ${row.texts.join(' | ')}`);
  return lines.join('\n');
};
