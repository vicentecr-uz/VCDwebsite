import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Stage } from '../../../lib/stageshow/stage';
import type { Act } from '../../../lib/stageshow/act';
import { mountSabiDemo } from '../../../lib/sabi/demo';
import replayIcon from 'lucide-static/icons/rotate-ccw.svg?raw';
import './sabi-stage.css';

type Controller = ReturnType<typeof mountSabiDemo>;
const example = 'A little more room to say what you mean, even when the words run past the edge.';
const empty = {};
const demoScale = 2;
const cursorRest = { wide: { x: 620, y: 290 }, compact: { x: 320, y: 290 } };

// Two tangent-matched curves per corner keep the flat sides easing into the turn.
function squircle(width: number, height: number, radius = 18) {
  const corner = [[radius, 0], [radius * .55, 0], [radius * .3182, 0], [radius * .1591, radius * .1591], [0, radius * .3182], [0, radius * .55], [0, radius]];
  const transforms = [
    (x: number, y: number) => [width - x, y],
    (x: number, y: number) => [width - y, height - x],
    (x: number, y: number) => [x, height - y],
    (x: number, y: number) => [y, x],
  ];
  return transforms.map((transform, index) => {
    const p = corner.map(([x, y]) => transform(x, y).join(' '));
    return `${index ? 'L' : 'M'} ${p[0]} C ${p.slice(1, 4).join(' ')} C ${p.slice(4).join(' ')}`;
  }).join(' ') + ' Z';
}

function SquircleField({ width, children, handles = false }: { width: number; children: ReactNode; handles?: boolean }) {
  const id = `sabi-clip-${useId().replace(/:/g, '')}`;
  const d = squircle(width, 64);
  return <div className={handles ? 'handle-example' : 'sabi-demo-field'} data-choice={handles ? 'container' : undefined}
    data-target={handles ? undefined : 'field'} data-cursor={handles ? undefined : 'ibeam'}
    role={handles ? 'img' : undefined} aria-label={handles ? 'Illustration of selection handles clipped to the field container' : undefined}
    style={{ '--sabi-clip': `url(#${id})` } as CSSProperties}>
    <svg className="sabi-field-shape" viewBox={`0 0 ${width} 64`} aria-hidden="true">
      <defs><clipPath id={id} clipPathUnits="objectBoundingBox"><path d={d} transform={`scale(${1 / width} ${1 / 64})`} /></clipPath></defs>
      <path className="sabi-field-fill" d={d} />
    </svg>
    <div className="sabi-field-clip">{children}</div>
  </div>;
}

function Scene({ kind, controller, onManual, compact }: {
  kind: string; controller: { current: Controller | null }; onManual: () => void; compact: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const handles = kind === 'handles';
  const comparison = !['playground', 'direction', 'handles'].includes(kind);
  const choices = handles ? ['Original', 'More room', 'No scroll', 'Container'] : ['Before', 'After'];
  useLayoutEffect(() => {
    const handle = mountSabiDemo(root.current!);
    controller.current = handle;
    return () => { handle.destroy(); controller.current = null; };
  }, [kind, controller]);
  useLayoutEffect(() => {
    const stage = root.current!.closest<HTMLElement>('.ss-stage')!;
    const field = root.current!.querySelector<HTMLElement>('.sabi-demo-field');
    if (!field) return;
    const placeKeys = () => {
      const scene = stage.getBoundingClientRect();
      if (!scene.height || !stage.offsetHeight) return;
      const scale = scene.height / stage.offsetHeight;
      const frameBottom = document.documentElement.clientHeight;
      const keysCenter = (field.getBoundingClientRect().bottom + frameBottom) / 2;
      stage.style.setProperty('--sabi-keys-y', `${(keysCenter - scene.top) / scale}px`);
      stage.style.setProperty('--sabi-frame-bottom', `${(frameBottom - scene.top) / scale}px`);
    };
    const observer = new ResizeObserver(placeKeys);
    observer.observe(stage);
    observer.observe(stage.parentElement!);
    observer.observe(field);
    observer.observe(document.documentElement);
    placeKeys();
    return () => observer.disconnect();
  }, [compact]);
  return <div ref={root} className="sabi-scene" data-kind={kind} data-mode="after"
    onPointerDownCapture={onManual} onKeyDownCapture={onManual} onFocusCapture={onManual} onWheelCapture={onManual}>
    {handles ? <SquircleField width={compact ? 326 : 480} handles>
      <div className="handle-viewport"><span className="handle-text">A little more <span className="selection">room<span className="handle start" /><span className="handle end" /></span> to say it.</span></div>
    </SquircleField> : <SquircleField width={compact ? 326 : 480}>
      {/* The input is uncontrolled: the guide yields the same DOM node to the reader. */}
      <sabi-input>
        <input aria-label={kind === 'direction' ? 'Try mixed-direction text' : 'Try Sabi'} defaultValue={kind === 'direction' ? 'שלום, Sabi 2026 — קצת מקום לכתוב ולערוך' : example} dir={kind === 'direction' ? 'auto' : undefined} autoComplete="off" spellCheck={false} />
      </sabi-input>
    </SquircleField>}
    {(comparison || handles) && <div className="dev-segmented sabi-choices" role="group" aria-label={handles ? 'Selection handle attempt' : 'Compare the fix'}>
      {choices.map((label, index) => <button key={label} type="button" className="dev-btn dev-btn--ghost dev-btn--align-center"
        data-target={label.toLowerCase().replace(' ', '-')} data-cursor="hand" data-choice={label.toLowerCase().replace(' ', '-')}
        aria-pressed={index === choices.length - 1 ? 'true' : 'false'}>{label}</button>)}
    </div>}
    {handles && <p className="sabi-caption">Selection handles · illustration</p>}
  </div>;
}

function Take({ kind }: { kind: string }) {
  const controller = useRef<Controller | null>(null);
  const [manual, setManual] = useState(false);
  const interrupt = useCallback(() => { controller.current?.stop(); setManual(true); }, []);
  // Adapted from stageshow's form-error: type, expose the problem, fix it, hold.
  const script = useCallback(async (a: Act<Record<string, never>>) => {
    const demo = controller.current;
    if (!demo) return;
    a.signal.addEventListener('abort', () => demo.stop(), { once: true });
    const comparison = kind !== 'playground';
    await a.wait(500);
    if (comparison) { await a.click({ at: 'before', x: .85, y: .55 }); demo.choose('before'); }
    await a.click({ at: 'field', x: .65, y: .5 });
    demo.begin();
    // Select all explains replacing the sample without a visible rewind.
    a.mark('keyboard');
    await a.key('cmd+a');
    demo.text('A');
    for (let i = 2; i <= example.length; i++) { demo.text(example.slice(0, i)); await a.wait(40); }
    await a.key('left');
    for (let offset = example.length - 1; offset >= 5; offset--) { demo.seek(offset); await a.wait(35); }
    if (kind === 'fade') { await a.key('End'); demo.seek(example.length); await a.wait(550); await a.key('Home'); demo.seek(0); }
    await a.wait(700);
    if (comparison) {
      a.mark('pointer');
      await a.click({ at: 'after', x: .85, y: .55 }); demo.choose('after'); demo.begin();
      await a.move({ at: 'field', x: .9, y: .5 });
      a.mark('keyboard');
      await a.key('End'); demo.seek(example.length);
      await a.key('left');
      for (let offset = example.length - 1; offset >= 5; offset--) { demo.seek(offset); await a.wait(35); }
      if (kind === 'fade') { await a.key('End'); demo.seek(example.length); await a.wait(550); await a.key('Home'); demo.seek(0); }
    }
    a.mark('pointer');
    await a.move(cursorRest);
    await a.wait(2000);
    demo.finish();
  }, [kind]);
  return <div className="sabi-show" data-manual={manual || undefined}>
    <Stage width={720} height={336} compact={{ below: 560, width: 358, height: 336 }} initial={empty} poster={empty}
      script={manual || kind === 'handles' || kind === 'direction' ? undefined : script} play="once" unframed
      palette="mono" fidelity="realistic" keys="bottom" cursor={kind === 'handles' || kind === 'direction' ? undefined : { at: cursorRest, style: 'real' }}
      tokens={{ '--ss-font': "'Hanken Grotesk', sans-serif", '--ss-surface': 'var(--sys-color-srf)', '--ss-text-strong': 'var(--sys-color-on-srf)', '--ss-line': 'var(--sys-color-surface-outline)',
        '--sabi-demo-scale': demoScale, '--sabi-fade-width': `${22 * demoScale}px`, '--sabi-fade-solid': `${8 * demoScale}px`,
        '--sabi-caret-penetration': `${4 * demoScale}px`, '--sabi-edge-gutter': `${8 * demoScale}px` }}>
      {(_state, _rect, layout) => <Scene kind={kind} controller={controller} onManual={interrupt} compact={layout === 'compact'} />}
    </Stage>
  </div>;
}

export default function SabiStage({ kind }: { kind: string }) {
  const [take, setTake] = useState(0);
  return <div className="sabi-demo">
    <Take key={take} kind={kind} />
    {!['handles', 'direction'].includes(kind) && <button type="button" className="dev-btn dev-btn--ghost sabi-replay"
      aria-label="Replay demo" title="Replay" onClick={() => setTake((value) => value + 1)}>
      <span className="dev-btn__icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: replayIcon }} />
    </button>}
  </div>;
}

declare global {
  namespace JSX { interface IntrinsicElements { 'sabi-input': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> } }
}
