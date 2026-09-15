import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window, BrowserErrorCaptureEnum } from 'happy-dom';
const source = readFileSync(new URL('../../src/components/DevAwardBlockSize.astro', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0].replace('if (import.meta.hot) import.meta.hot.dispose(() => cleanup?.());', '');
const code = new Bun.Transpiler({loader:'ts'}).transformSync(source);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(query = '', fail = false) {
  const window = new Window({url:`http://localhost/${query}`, settings:{errorCapture:BrowserErrorCaptureEnum.disabled}});
  const document = window.document;
  document.body.innerHTML = `<div data-dev-overlay hidden><div data-award-block-size-panel data-defaults='{"mobile":64,"tablet":96,"desktop":120}'>${['desktop','tablet','mobile'].map(bp=>`<button data-award-block-viewport="${bp}"></button>`).join('')}<input type="range" min="32" max="200" data-award-block-size><output data-award-block-size-readout></output><p data-award-block-size-status></p><button data-award-block-size-reset></button><button data-award-block-size-save></button></div></div>`;
  const writes: unknown[] = [];
  const fetch = async (_url: string, options: any) => { writes.push(JSON.parse(options.body)); return {ok:!fail, json:async()=>fail ? {error:'Write failed'} : {path:'src/lib/awardBlockSize.json'}}; };
  new Function('window','document','MutationObserver','AbortController','fetch',code)(window,document,window.MutationObserver,window.AbortController,fetch);
  const q = (selector: string) => document.querySelector(selector) as any;
  const height = () => document.documentElement.style.getPropertyValue('--award-block-height-live');
  return {window,document,q,height,writes};
}
test('hidden panel leaves responsive sizing untouched; open, breakpoint, slider, reset and close update live height', async()=>{
  const f=setup();
  expect(f.height()).toBe('');
  const overlay=f.q('[data-dev-overlay]'); overlay.hidden=false; await settle();
  f.q('[data-award-block-viewport="mobile"]').click();
  expect(f.height()).toBe('64px');
  const slider=f.q('input'); slider.value='80'; slider.dispatchEvent(new f.window.Event('input'));
  expect(f.height()).toBe('80px');
  f.q('[data-award-block-size-reset]').click(); expect(f.height()).toBe('64px');
  overlay.hidden=true; await settle(); expect(f.height()).toBe('');
  await f.window.happyDOM.close();
});
test('query opens panel, Save persists all breakpoints and Reset returns to latest save',async()=>{
  const f=setup('?award-size=1');
  f.q('[data-award-block-viewport="tablet"]').click();
  const slider=f.q('input'); slider.value='88'; slider.dispatchEvent(new f.window.Event('input'));
  f.q('[data-award-block-size-save]').click(); await settle();
  expect(f.writes).toEqual([{mobile:64,tablet:88,desktop:120}]);
  expect(f.q('[data-award-block-size-status]').textContent).toContain('src/lib/awardBlockSize.json');
  slider.value='90'; slider.dispatchEvent(new f.window.Event('input'));
  f.q('[data-award-block-size-reset]').click(); expect(f.height()).toBe('88px');
  f.document.dispatchEvent(new f.window.Event('astro:before-swap')); expect(f.height()).toBe('');
  await f.window.happyDOM.close();
});
test('failed save exposes an error and re-enables controls',async()=>{
  const f=setup('?award-size=1',true);
  f.q('[data-award-block-size-save]').click(); await settle();
  expect(f.q('[data-award-block-size-status]').textContent).toBe('Write failed');
  expect(f.q('[data-award-block-size-save]').disabled).toBe(false);
  await f.window.happyDOM.close();
});
