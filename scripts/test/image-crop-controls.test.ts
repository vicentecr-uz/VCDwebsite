import { expect, test } from 'bun:test';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

const componentPath = new URL('../../src/components/project/ImageCropControls.astro', import.meta.url);

async function loadCompiledComponent() {
  const source = await Bun.file(componentPath).text();
  const transformed = await transform(source, {
    filename: componentPath.pathname,
    internalURL: 'astro/runtime/server/index.js',
  });
  const cssImport = transformed.code.indexOf("import '../../styles/imageCropTuner.css';");
  const runtimeImports = transformed.code
    .slice(0, cssImport)
    .replace(/\s*createMetadata as \$\$createMetadata,?\n/, '\n');
  const componentCode = transformed.code
    .slice(cssImport)
    .replace(/^import .*?;\n/gm, '');
  const sourceModule = `${runtimeImports}
const $$createMetadata = () => ({});
const $$module1 = {};
const $$module2 = {};
const $$module3 = {};
const $$module4 = {};
const $$module5 = {};
const $$module6 = {};
const SelectField = Fragment;
const alignCenterVerticalIcon = '';
const alignCenterHorizontalIcon = '';
const maximizeIcon = '';
const lockIcon = '';
const sizeIcon = (value) => value;
${componentCode}`;
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(sourceModule);
  return (await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`)).default;
}

const expectedControls = [
  'data-crop-preview',
  'data-crop-image',
  'data-crop-center-x',
  'data-crop-center-y',
  'data-crop-fit',
  'data-crop-constraint',
  'data-crop-resize="n"',
  'data-crop-resize="s"',
  'data-crop-resize="e"',
  'data-crop-resize="w"',
  'data-crop-resize="ne"',
  'data-crop-resize="nw"',
  'data-crop-resize="se"',
  'data-crop-resize="sw"',
];

test('image crop controls keep the tuner controls when cropLabel is supplied', async () => {
  const component = await loadCompiledComponent();
  const container = await AstroContainer.create();
  const html = await container.renderToString(component, {
    props: { imageSrc: '/image.jpg' },
    slots: { cropLabel: '<span data-custom-crop-label>Custom crop</span>' },
  });

  expect(html).toContain('data-custom-crop-label');
  for (const control of expectedControls) expect(html).toContain(control);
});

test('image crop controls render the default crop label and complete tuner', async () => {
  const component = await loadCompiledComponent();
  const container = await AstroContainer.create();
  const html = await container.renderToString(component, { props: { imageSrc: '/image.jpg' } });

  expect(html).toContain('>Crop</span>');
  for (const control of expectedControls) expect(html).toContain(control);
});
