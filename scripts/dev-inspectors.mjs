/**
 * Add the animation and annotation inspectors to every Astro dev page,
 * including standalone diagnostic pages that do not use Layout.astro.
 *
 * @returns {import('astro').AstroIntegration}
 */
export function devInspectors() {
  return {
    name: 'vcd-dev-inspectors',
    hooks: {
      'astro:config:setup': ({ command, injectScript }) => {
        if (command !== 'dev') return;
        injectScript('page', "import '/src/lib/lapseDev.ts';\nimport '/src/lib/agentationDev.ts';");
      },
    },
  };
}
