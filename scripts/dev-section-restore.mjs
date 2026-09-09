const clone = (value) => structuredClone(value);

const sectionIdentity = (section) => new Set(
  [section?.id, section?.sectionId]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()),
);

const receiptError = (message) => new Error(`Could not restore that section: ${message}`);

/**
 * Keeps delete receipts in memory for the lifetime of one dev server. The
 * receipt contains the server-owned section and outline data; clients only
 * receive an opaque token.
 */
export function createSectionRestoreStore() {
  const receipts = new Map();

  return {
    remember(documentKey, section, outlineEntries) {
      if (!documentKey || !section || typeof section !== 'object' || Array.isArray(section)) {
        throw receiptError('the deleted section is invalid.');
      }
      const token = crypto.randomUUID();
      receipts.set(token, {
        documentKey: String(documentKey),
        section: clone(section),
        outlineEntries: clone(Array.isArray(outlineEntries) ? outlineEntries : []),
        state: 'available',
      });
      return token;
    },

    restore(documentKey, token, data, index) {
      const receipt = receipts.get(String(token || ''));
      if (!receipt) throw receiptError('that restore receipt is unknown or expired.');
      if (receipt.documentKey !== String(documentKey)) throw receiptError('that receipt belongs to another document.');
      if (receipt.state !== 'available') throw receiptError('that restore receipt has already been used.');
      if (!data || typeof data !== 'object' || !Array.isArray(data.sections)) {
        throw receiptError('the sections list is out of date.');
      }
      if (!Number.isInteger(index) || index < 0 || index > data.sections.length) {
        throw receiptError('the restore position is invalid.');
      }

      const identities = sectionIdentity(receipt.section);
      const collision = data.sections.some((section) => [...sectionIdentity(section)].some((id) => identities.has(id)));
      if (collision) throw receiptError('a section with that id already exists.');

      receipt.state = 'staged';
      return clone(receipt.section);
    },

    commit(documentKey, token) {
      const receipt = receipts.get(String(token || ''));
      if (!receipt || receipt.documentKey !== String(documentKey) || receipt.state !== 'staged') {
        throw receiptError('that restore receipt is unknown or already used.');
      }
      receipt.state = 'used';
    },

    release(documentKey, token) {
      const receipt = receipts.get(String(token || ''));
      if (receipt && receipt.documentKey === String(documentKey) && receipt.state === 'staged') {
        receipt.state = 'available';
      }
    },

    restoreOutline(data, token) {
      const receipt = receipts.get(String(token || ''));
      if (!receipt || receipt.state !== 'staged') throw receiptError('that restore receipt is unknown or already used.');
      const entries = receipt.outlineEntries
        .map((item) => (item && typeof item === 'object' && 'entry' in item
          ? { entry: item.entry, index: item.index }
          : { entry: item, index: Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.index - b.index);
      if (!Array.isArray(data.outline)) data.outline = [];
      for (const item of entries) {
        const at = Number.isInteger(item.index) ? Math.min(Math.max(item.index, 0), data.outline.length) : data.outline.length;
        data.outline.splice(at, 0, clone(item.entry));
      }
    },
  };
}
