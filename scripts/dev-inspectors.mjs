import { createRequire } from 'node:module';

export const lapseInstalled = (() => {
  try {
    createRequire(import.meta.url).resolve('@aiforui/lapse/panel');
    return true;
  } catch {
    return false;
  }
})();

/** @returns {import('astro').AstroIntegration} */
export function devInspectors() {
  return {
    name: 'vcd-dev-inspectors',
    hooks: {
      'astro:config:setup': ({ command, injectScript, updateConfig }) => {
        if (command !== 'dev') return;
        updateConfig({
          vite: {
            optimizeDeps: {
              include: [
                'agentation',
                ...(lapseInstalled ? ['@aiforui/lapse/install', '@aiforui/lapse/panel'] : []),
              ],
            },
            server: {
              warmup: {
                clientFiles: ['./src/lib/lapseDev.ts', './src/lib/agentationDev.ts'],
              },
            },
          },
        });
        injectScript('page', "import '/src/lib/lapseDev.ts';\nimport '/src/lib/agentationDev.ts';");
      },
    },
  };
}
