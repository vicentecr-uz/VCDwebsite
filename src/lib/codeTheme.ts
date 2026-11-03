// Shiki theme for every code surface: three greys after sonner.emilkowal.ski,
// drawn from the sys.color.code-* tokens so light/dark and /styles edits follow.
// Names carry the ink; keywords, strings and attributes recede; punctuation
// and comments recede further.
export const codeTheme = {
  name: 'vcd-code',
  type: 'light',
  fg: 'var(--sys-color-code-ink)',
  bg: 'transparent',
  settings: [
    { settings: { foreground: 'var(--sys-color-code-ink)' } },
    {
      scope: ['keyword', 'storage', 'string', 'constant.numeric', 'constant.language', 'entity.other.attribute-name', 'support.type.property-name', 'punctuation.definition.string'],
      settings: { foreground: 'var(--sys-color-code-ink-muted)' },
    },
    {
      scope: ['punctuation', 'comment', 'keyword.operator', 'meta.brace'],
      settings: { foreground: 'var(--sys-color-code-ink-faint)' },
    },
  ],
} as never;
