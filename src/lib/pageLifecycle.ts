type Cleanup = () => void;

/** Own resources that otherwise outlive a replaced page. */
export function createPageScope() {
  const controller = new AbortController();
  const cleanups: Cleanup[] = [];
  const frames = new Set<number>();
  const timers = new Set<number>();
  const scope = {
    signal: controller.signal,
    add(cleanup: Cleanup) { cleanups.push(cleanup); },
    listen<K extends string>(target: EventTarget | null | undefined, type: K, listener: ((event: K extends keyof GlobalEventHandlersEventMap ? GlobalEventHandlersEventMap[K] : Event) => void) | EventListenerObject, options: AddEventListenerOptions | boolean = {}) {
      target?.addEventListener(type, listener as EventListenerOrEventListenerObject, { ...(typeof options === 'boolean' ? { capture: options } : options), signal: controller.signal });
    },
    frame(callback: FrameRequestCallback) {
      if (controller.signal.aborted) return 0;
      let id = 0;
      id = requestAnimationFrame((time) => { frames.delete(id); if (!controller.signal.aborted) callback(time); });
      frames.add(id);
      return id;
    },
    timeout(callback: () => void, delay = 0) {
      if (controller.signal.aborted) return 0;
      const id = window.setTimeout(() => { timers.delete(id); if (!controller.signal.aborted) callback(); }, delay);
      timers.add(id);
      return id;
    },
    destroy() {
      if (controller.signal.aborted) return;
      controller.abort();
      frames.forEach(cancelAnimationFrame);
      timers.forEach((id) => window.clearTimeout(id));
      frames.clear(); timers.clear();
      cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    },
  };
  return scope;
}

/** Scripts load once; each new main element gets exactly one mounted controller. */
export function onPageLoad(mount: () => void | Cleanup) {
  let main: Element | null | undefined;
  let cleanup: void | Cleanup;
  const unmount = () => { cleanup?.(); cleanup = undefined; main = undefined; };
  const boot = () => {
    const next = document.getElementById('main-content');
    if (main === next) return;
    unmount(); main = next; cleanup = mount();
  };
  boot();
  document.addEventListener('astro:page-load', boot);
  document.addEventListener('astro:before-swap', unmount);
  return () => {
    unmount();
    document.removeEventListener('astro:page-load', boot);
    document.removeEventListener('astro:before-swap', unmount);
  };
}
