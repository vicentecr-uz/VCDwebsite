import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const header = readFileSync(resolve(root, 'src/components/Header.astro'), 'utf8');
const start = header.indexOf('  const KERN_MAX_PASSES = 3;');
const end = header.indexOf('  // Metrics are only final once the real face is in', start);
const kerningSource = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  `${header.slice(start, end)}\nreturn applyWordmarkKerning;`,
);

type Fixture = {
  apply: () => void;
  margins: () => number[];
};

function fixture(scale: number, target: number[], rendered = true): Fixture {
  const fontSize = 16;
  const chars = target.map((_, index) => {
    const style: { marginLeft: string } = { marginLeft: '' };
    const char = {
      textContent: index === 0 ? 'V' : 'i',
      style,
      _marginPx: 0,
      getBoundingClientRect() {
        const margin = index === 0 ? 0 : (this as typeof char)._marginPx;
        return { left: 100 + (10 + margin) * scale, width: 10 * scale };
      },
    };
    return char;
  });
  chars[0].getBoundingClientRect = () => ({ left: 100, width: 10 * scale });

  const wordmark = {
    querySelectorAll: () => chars,
    getBoundingClientRect: () => ({ left: 100, width: rendered ? (20 + chars[1]._marginPx) * scale : 0 }),
  };
  const probe = {
    style: {} as Record<string, string>,
    firstChild: {},
    textContent: '',
    getBoundingClientRect: () => ({ left: 0, width: target.at(-1)! + 10 }),
    remove() {},
  };
  const document = {
    querySelectorAll: () => [wordmark],
    createElement: () => probe,
    body: { appendChild() {} },
    createRange: () => ({
      setStart(_node: unknown, index: number) { (this as any).index = index; },
      setEnd() {},
      getBoundingClientRect() { return { left: target[(this as any).index] }; },
    }),
  };
  const getComputedStyle = (element: any) => ({
    width: element === wordmark ? String(20 + chars[1]._marginPx) : '',
    fontSize: `${fontSize}px`,
    fontFamily: 'sans-serif', fontWeight: '400', fontStyle: 'normal', fontKerning: 'auto',
    fontFeatureSettings: 'normal', letterSpacing: '0px',
    marginLeft: element.style?.marginLeft?.endsWith('em')
      ? `${parseFloat(element.style.marginLeft) * fontSize}px`
      : element.style?.marginLeft || '0px',
  });
  chars.forEach((char) => {
    Object.defineProperty(char.style, 'marginLeft', {
      get: () => char._marginPx ? `${char._marginPx / fontSize}em` : '',
      set: (value: string) => { char._marginPx = value ? parseFloat(value) * fontSize : 0; },
    });
  });
  const apply = new Function('document', 'getComputedStyle', kerningSource)(document, getComputedStyle);
  return { apply, margins: () => chars.map((char) => char._marginPx) };
}

test('normalizes intro-scaled offsets and settles the same margins repeatedly', () => {
  const expected = fixture(1, [0, 9.4]);
  expected.apply();
  const scaled = fixture(1.03, [0, 9.4]);
  scaled.apply();
  expect(scaled.margins()[1]).toBeCloseTo(expected.margins()[1]);
  scaled.apply();
  expect(scaled.margins()[1]).toBeCloseTo(expected.margins()[1]);
});

test('leaves native kerning alone and skips a hidden wordmark safely', () => {
  const native = fixture(1.03, [0, 10]);
  native.apply();
  expect(native.margins()).toEqual([0, 0]);
  const hidden = fixture(1.03, [0, 9.4], false);
  expect(() => hidden.apply()).not.toThrow();
  expect(hidden.margins()).toEqual([0, 0]);
});
