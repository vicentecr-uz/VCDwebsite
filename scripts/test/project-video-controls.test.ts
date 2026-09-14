import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { sizeIcon } from '../../src/lib/icons';

const window = new Window({ url: 'http://localhost:4322' });
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLVideoElement', 'HTMLMediaElement', 'DocumentFragment', 'EventTarget', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'customElements', 'localStorage', 'navigator', 'DOMParser']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : (window as any)[key] });
}
Object.assign(globalThis, {
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});
// Happy DOM cannot parse ::slotted here; playback tests do not depend on CSS matching.
const insertRule = window.CSSStyleSheet.prototype.insertRule;
window.CSSStyleSheet.prototype.insertRule = function(rule: string, index?: number) {
  return insertRule.call(this, rule.replace(/, ::slotted\([^)]*\)/g, '').replace(/\{\s*\}$/, '{ color: white; }'), index);
};
await import('media-chrome');
const source = readFileSync(new URL('../../src/lib/projectVideoControls.ts', import.meta.url), 'utf8');
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.replace(/^import .*;\n/gm, '').replaceAll('export function', 'function'));
const svg = (name: string) => readFileSync(new URL(`../../node_modules/lucide-static/icons/${name}.svg`, import.meta.url), 'utf8');
const env = { sizeIcon, playIcon: svg('play'), pauseIcon: svg('pause'), volumeIcon: svg('volume-2'), muteIcon: svg('volume-x') };
const { enhanceProjectVideo } = new Function('env', `with(env) { ${code}; return { enhanceProjectVideo }; }`)(env);
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 20)); };

for (const existing of [false, true]) {
  test(`${existing ? 'standalone' : 'inline'} video shares one functioning controller`, async () => {
    const root = window.document.createElement('div');
    root.innerHTML = existing
      ? '<media-controller novolumepref nomutedpref><video controls data-project-inline-video slot="media"></video></media-controller>'
      : '<video controls data-project-inline-video></video>';
    const video = root.querySelector('video')!;
    video.remote.cancelWatchAvailability = async () => {};
    // Happy DOM does not emit the browser's volumechange events from these setters.
    for (const property of ['volume', 'muted']) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, property)!;
      Object.defineProperty(video, property, {
        get: () => descriptor.get!.call(video),
        set: (value) => {
          descriptor.set!.call(video, value);
          video.dispatchEvent(new window.Event('volumechange'));
        },
      });
    }
    window.document.body.append(root);
    enhanceProjectVideo(video);
    enhanceProjectVideo(video);
    await settle();
    const controller = root.querySelector('media-controller')! as any;
    expect(root.querySelectorAll('media-controller')).toHaveLength(1);
    expect(root.querySelectorAll('media-play-button')).toHaveLength(1);
    expect(root.querySelector('media-play-button svg')?.getAttribute('fill')).toBe('currentColor');
    expect(controller.media).toBe(video);
    expect(video.controls).toBe(false);
    expect(video.volume).toBe(0.5);
    expect(root.querySelector('media-volume-range')?.shadowRoot?.querySelector('input')?.getAttribute('aria-orientation')).toBe('vertical');
    expect([...root.querySelectorAll('media-mute-button svg')].map((node) => node.getAttribute('slot'))).toEqual(['off', 'low', 'medium', 'high']);
    root.querySelector('media-mute-button')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(video.muted).toBe(true);
    const volumeInput = root.querySelector('media-volume-range')!.shadowRoot!.querySelector('input')!;
    volumeInput.value = '0.4';
    volumeInput.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(false);
    const mute = root.querySelector('media-mute-button')!;
    mute.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.4);
    await settle();
    expect(volumeInput.value).toBe('0.4');
    expect(volumeInput.getAttribute('aria-valuetext')).toBe('40% (muted)');
    expect(root.querySelector('media-volume-range')!.hasAttribute('mediamuted')).toBe(true);
    mute.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }));
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.4);

    volumeInput.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true, composed: true }));
    volumeInput.value = '0.8';
    volumeInput.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
    expect(video.volume).toBe(0.4);
    expect(volumeInput.value).toBe('0.8');
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1 }));
    expect(video.volume).toBe(0.8);

    volumeInput.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 2, button: 0, bubbles: true, composed: true }));
    volumeInput.value = '0.2';
    volumeInput.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
    window.dispatchEvent(new window.PointerEvent('pointercancel', { pointerId: 2 }));
    expect(video.volume).toBe(0.8);
    expect(volumeInput.value).toBe('0.8');
    const wheel = new window.WheelEvent('wheel', { deltaY: -50, bubbles: true, cancelable: true });
    mute.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(video.volume).toBeCloseTo(0.75);
    mute.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
    expect(video.volume).toBeCloseTo(0.8);
    root.remove();
  });
}
