import assert from 'node:assert/strict';
import test from 'node:test';
import { devInspectors } from '../dev-inspectors.mjs';

for (const command of ['dev', 'build', 'preview', 'sync']) {
  test(`shared inspectors are ${command === 'dev' ? 'available' : 'excluded'} during ${command}`, () => {
    const scripts = [];
    devInspectors().hooks['astro:config:setup']({
      command,
      injectScript: (stage, content) => scripts.push({ stage, content }),
    });
    if (command !== 'dev') {
      assert.deepEqual(scripts, []);
      return;
    }
    assert.ok(scripts.length > 0);
    assert.ok(scripts.every(({ stage }) => stage === 'page'));
    const content = scripts.map(({ content }) => content).join('\n');
    assert.match(content, /\/src\/lib\/agentationDev/);
    assert.match(content, /\/src\/lib\/lapseDev/);
  });
}
