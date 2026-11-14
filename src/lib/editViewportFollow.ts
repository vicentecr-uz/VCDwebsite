import type { createPageScope } from './pageLifecycle';

export function followEditViewport(scope: ReturnType<typeof createPageScope>) {
  let preset = 'desktop';
  let applying = false;
  const viewportOf = (button: Element) => [...button.attributes].find((attribute) => /^data-[a-z-]+-viewport$/.test(attribute.name))?.value;
  const apply = () => {
    document.querySelectorAll<HTMLElement>('.dev-segmented').forEach((group) => {
      if (!group.getClientRects().length) return;
      const button = [...group.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        [...button.attributes].some((attribute) => /^data-[a-z-]+-viewport$/.test(attribute.name) && attribute.value === preset),
      );
      if (button && !button.classList.contains('is-active') && button.getAttribute('aria-pressed') !== 'true') {
        applying = true;
        try { button.click(); } finally { applying = false; }
      }
    });
  };
  scope.listen(window, 'vcd:edit-viewport-change', ((event: CustomEvent<{ preset?: string }>) => {
    const next = event.detail?.preset;
    if (next !== 'desktop' && next !== 'tablet' && next !== 'mobile') return;
    preset = next;
    apply();
  }) as EventListener);
  // Choosing a viewport in a panel shows that viewport in the preview.
  scope.listen(document, 'click', (event) => {
    if (applying || !document.documentElement.classList.contains('is-dev-mode')) return;
    const button = (event.target as Element | null)?.closest?.('.dev-segmented > button');
    const next = button && viewportOf(button);
    if (next !== 'desktop' && next !== 'tablet' && next !== 'mobile' || next === preset) return;
    window.dispatchEvent(new window.CustomEvent('vcd:edit-viewport-request', { detail: { preset: next } }));
  });
  scope.listen(window, 'vcd:dev-edit-open', () => scope.frame(() => scope.frame(apply)));
}
