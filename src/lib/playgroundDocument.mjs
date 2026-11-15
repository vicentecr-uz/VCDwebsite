export const PLAYGROUND_DOCUMENT = 'editor-playground';

export function isEditableDocument(documentKey) {
  return import.meta.env?.DEV || documentKey === PLAYGROUND_DOCUMENT;
}
