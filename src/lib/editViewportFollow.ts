import type { createPageScope } from './pageLifecycle';

export function followEditViewport(scope: ReturnType<typeof createPageScope>) {
  let preset = 'desktop';
  const apply = () => {
    document.querySelectorAll<HTMLElement>('.dev-segmented').forEach((group) => {
      if (!group.getClientRects().length) return;
      const button = [...group.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        [...button.attributes].some((attribute) => /^data-[a-z-]+-viewport$/.test(attribute.name) && attribute.value === preset),
      );
      if (button && !button.classList.contains('is-active') && button.getAttribute('aria-pressed') !== 'true') button.click();
    });
  };
  scope.listen(window, 'vcd:edit-viewport-change', ((event: CustomEvent<{ preset?: string }>) => {
    const next = event.detail?.preset;
    if (next !== 'desktop' && next !== 'tablet' && next !== 'mobile') return;
    preset = next;
    apply();
  }) as EventListener);
  scope.listen(window, 'vcd:dev-edit-open', () => scope.frame(() => scope.frame(apply)));
}
