// @ts-check
/**
 * Magenta-alarm split for the token generator.
 * `bun scripts/test/build-tokens.test.mjs`
 */
import { generateAlarmBlock, generateTokenBlock } from '../build-tokens.mjs';

let failures = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const fixture = {
  ref: {
    palette: {
      grey: {
        1000: { $type: 'color', $value: '#ffffff' },
      },
    },
  },
  sys: {
    color: {
      srf: {
        $type: 'color',
        $extensions: { modes: { light: '#ffffff', dark: '#000000' } },
        $value: '#ffffff',
      },
      primary: {
        $type: 'color',
        $extensions: { modes: { light: '#ff00ff', dark: '#FF00FF' } },
        $value: '#ff00ff',
      },
    },
  },
  comp: {
    button: {
      label: { $type: 'color', $value: '{sys.color.srf}' },
    },
  },
};

const production = generateTokenBlock(fixture);
const alarms = generateAlarmBlock(fixture);

check('production omits #ff00ff', !/#ff00ff/i.test(production));
check('production keeps filled sys tokens', production.includes('--sys-color-srf: #ffffff'));
check('production has no OS dark media query', !production.includes('prefers-color-scheme'));
check('production still has data-theme="dark"', production.includes(':root[data-theme="dark"]'));
check('alarm generator contains #ff00ff', /#ff00ff/i.test(alarms));
check('alarm generator includes the unfilled token', alarms.includes('--sys-color-primary:'));
check('alarm generator omits filled tokens', !alarms.includes('--sys-color-srf:'));

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nbuild-tokens tests passed');
