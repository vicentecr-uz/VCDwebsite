type Draft = {
  document: Record<string, any>;
  uploads: PlaygroundUpload[];
  deleted: string[];
};

export type PlaygroundUpload = {
  src: string;
  filename: string;
  blob: Blob;
  dimensions: { srcWidth: number; srcHeight: number };
};

export async function openPlaygroundDraft() {
  const sessionKey = 'vcd:editor-playground:session';
  const key = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID();
  sessionStorage.setItem(sessionKey, key);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vcd-editor-playground', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Could not open the playground draft.'));
  });
  database.onversionchange = () => database.close();
  const draft = await new Promise<Draft | undefined>((resolve, reject) => {
    const request = database.transaction('drafts').objectStore('drafts').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    draft,
    write(value: Draft | null) {
      return new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('drafts', 'readwrite');
        const drafts = transaction.objectStore('drafts');
        if (value) drafts.put(value, key);
        else drafts.delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the playground draft.'));
      });
    },
  };
}
