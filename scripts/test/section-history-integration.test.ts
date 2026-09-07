import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHistory } from '../../src/lib/devHistory';

const source = readFileSync(new URL('../../src/components/project/ProjectSectionNavEditor.astro', import.meta.url), 'utf8');
const start = source.indexOf('          (historyScope ?? pageHistory).push(');
const end = source.indexOf('          } });', start);
if (start < 0 || end < 0) throw new Error('Could not extract section history command');
const command = source.slice(start, end + '          } });'.length);

for (const active of [true, false]) {
  test(`production outline command restores state with section mode ${active ? 'open' : 'closed'}`, async () => {
    const pageHistory = createHistory();
    let text = 'edited';
    pageHistory.push({ label: 'Text', undo: () => { text = 'original'; }, redo: () => { text = 'edited'; } });
    const historyScope = pageHistory.scope();
    const block = { value: 'Research QA' };
    const otherBlock = { value: 'Other' };
    const calls: string[] = [];
    const env = {
      historyScope, pageHistory, block, before: { value: 'Research' }, current: { value: 'Research QA' },
      mergeKey: undefined, touched: new Map(), activeBlock: otherBlock,
      capture: (target: typeof block) => ({ ...target }),
      restore: (state: typeof block) => { block.value = state.value; },
      isActive: () => active, liveBlock: () => block,
      syncDevSectionOutlineSidebar: () => calls.push('sidebar'),
      renderSelection: () => calls.push('selection'), stage: () => calls.push('stage'),
    };
    new Function('env', `with (env) { ${command} }`)(env);
    await historyScope.undo();
    expect(block.value).toBe('Research');
    expect(env.activeBlock).toBe(active ? block : otherBlock);
    expect(env.touched.get(block)).toEqual({ value: 'Research QA' });
    expect(calls).toEqual(['sidebar', 'selection', 'stage']);
    await historyScope.undo();
    expect(text).toBe('edited');
    env.activeBlock = otherBlock;
    await historyScope.redo();
    expect(block.value).toBe('Research QA');
    expect(env.activeBlock).toBe(active ? block : otherBlock);
    expect(calls).toEqual(['sidebar', 'selection', 'stage', 'sidebar', 'selection', 'stage']);
    await pageHistory.undo();
    await pageHistory.undo();
    expect(text).toBe('original');
  });
}
