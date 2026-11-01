import { createPortal, flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Drawer } from '@base-ui/react/drawer';
import messageSquareIcon from 'lucide-static/icons/message-square.svg?raw';

type Note = { text: string; revision: number };
type Block = { id: string; document: string; element: HTMLElement };
type Editing = Block & { baseline: Note; trigger: HTMLButtonElement };
const keyFor = (block: Block) => `${block.document}:${block.id}`;
const draftKey = (block: Block) => `vcd:component-note:${keyFor(block)}`;
const empty: Note = { text: '', revision: 0 };
const isNote = (value: unknown): value is Note => {
  const note = value as Note | null;
  return Boolean(note && typeof note.text === 'string' && note.text.length <= 8000
    && Number.isSafeInteger(note.revision) && note.revision >= 0);
};
const readDraft = (block: Block): Note | undefined => {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(block)) || 'null');
    return isNote(value) ? value : undefined;
  } catch { return undefined; }
};
const findBlocks = (): Block[] => [...document.querySelectorAll<HTMLElement>('[data-dev-content-id][data-dev-spacing-document]')]
  .filter((element) => !['bodyText', 'sectionTitle'].includes(element.dataset.devSectionDeletable || '')
    && (!element.classList.contains('project-block--text') || element.classList.contains('project-details')))
  .map((element) => ({ id: element.dataset.devContentId!, document: element.dataset.devSpacingDocument!, element }));

export default function ComponentNoteDrawer() {
  const [active, setActive] = useState(document.documentElement.classList.contains('is-dev-mode'));
  const [blocks, setBlocks] = useState<Block[]>(findBlocks);
  const [notes, setNotes] = useState<Record<string, Record<string, Note>>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Note>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const documents = [...new Set(blocks.map((block) => block.document))].sort().join(',');

  useEffect(() => {
    alive.current = true;
    const mode = () => setActive(document.documentElement.classList.contains('is-dev-mode'));
    window.addEventListener('vcd:dev-mode-change', mode);
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = findBlocks();
        setBlocks((previous) => previous.length === next.length
          && previous.every((block, i) => block.element === next[i].element && keyFor(block) === keyFor(next[i])) ? previous : next);
      });
    });
    observer.observe(document.getElementById('main-content') || document.body, { childList: true, subtree: true });
    return () => {
      alive.current = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('vcd:dev-mode-change', mode);
      requests.current.forEach((controller) => controller.abort());
    };
  }, []);

  useEffect(() => {
    blocks.forEach((block) => block.element.classList.add('dev-component-note-target'));
    const recovered: Record<string, Note> = {};
    blocks.forEach((block) => { const draft = readDraft(block); if (draft) recovered[keyFor(block)] = draft; });
    setDrafts(recovered);
    return () => blocks.forEach((block) => block.element.classList.remove('dev-component-note-target'));
  }, [blocks]);

  const request = async (url: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    requests.current.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
      return { response, payload: await response.json() };
    }
    finally { clearTimeout(timeout); requests.current.delete(controller); }
  };
  const load = async (documentKey: string) => {
    try {
      const { response, payload } = await request(`/api/component-notes?document=${encodeURIComponent(documentKey)}`);
      if (!response.ok || !payload.notes || Object.values(payload.notes).some((note) => !isNote(note))) throw new Error('load');
      if (!alive.current) return;
      setNotes((previous) => ({ ...previous, [documentKey]: payload.notes }));
      setLoadErrors((previous) => ({ ...previous, [documentKey]: false }));
    } catch {
      if (alive.current) setLoadErrors((previous) => ({ ...previous, [documentKey]: true }));
    }
  };
  useEffect(() => {
    if (active) documents.split(',').filter(Boolean).forEach((documentKey) => { void load(documentKey); });
  }, [active, documents]);

  const remember = (block: Block, note: Note) => {
    setDrafts((previous) => ({ ...previous, [keyFor(block)]: note }));
    try { localStorage.setItem(draftKey(block), JSON.stringify(note)); } catch { /* The open editor still retains the text. */ }
  };
  const forget = (block: Block) => {
    setDrafts((previous) => { const next = { ...previous }; delete next[keyFor(block)]; return next; });
    try { localStorage.removeItem(draftKey(block)); } catch { /* Saved server data remains authoritative. */ }
  };
  const openNote = (block: Block, trigger: HTMLButtonElement) => {
    if (busy.current) return;
    if (!notes[block.document]) { void load(block.document); return; }
    const saved = notes[block.document][block.id] || empty;
    const recovery = drafts[keyFor(block)];
    flushSync(() => {
      setEditing({ ...block, baseline: recovery || saved, trigger });
      setText(recovery?.text ?? saved.text);
      setError('');
      setConflict(null);
      setOpen(true);
    });
    field.current?.focus({ preventScroll: true });
    field.current?.setSelectionRange(field.current.value.length, field.current.value.length);
  };
  const closeNote = () => {
    const element = viewport.current;
    if (element) {
      element.style.setProperty('--note-dismiss-inset', getComputedStyle(element).getPropertyValue('--drawer-keyboard-inset') || '0px');
    }
    setOpen(false);
    field.current?.blur();
  };
  const saveAndClose = async (revision = editing?.baseline.revision) => {
    if (!editing || busy.current) return;
    const target = editing;
    const value = text;
    const saved = notes[target.document]?.[target.id] || empty;
    if (value === saved.text) { forget(target); closeNote(); return; }
    remember(target, { text: value, revision: revision! });
    busy.current = true;
    setSaving(true);
    setError('');
    closeNote();
    try {
      const { response, payload } = await request('/api/component-notes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: target.document, sectionId: target.id, text: value.trim() ? value : '', revision }),
      });
      if (!alive.current) return;
      if (response.status === 409 && isNote(payload.current)) {
        setConflict(payload.current);
        setError('This note changed elsewhere.');
        setOpen(true);
        return;
      }
      if (!response.ok || !isNote(payload)) throw new Error('save');
      setNotes((previous) => ({ ...previous, [target.document]: { ...previous[target.document], [target.id]: payload } }));
      forget(target);
      setOpen(false);
    } catch {
      if (alive.current) {
        setError('Not saved. Close to try again.');
        setOpen(true);
      }
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const useSaved = () => {
    if (!editing || !conflict) return;
    setNotes((previous) => ({ ...previous, [editing.document]: { ...previous[editing.document], [editing.id]: conflict } }));
    setEditing({ ...editing, baseline: conflict });
    setText(conflict.text);
    forget(editing);
    setConflict(null);
    setError('');
  };
  useEffect(() => {
    const dirty = Object.entries(drafts).some(([key, note]) => {
      const block = blocks.find((block) => keyFor(block) === key);
      return block && note.text !== (notes[block.document]?.[block.id]?.text || '');
    });
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy.current) { event.preventDefault(); event.returnValue = ''; } };
    const hasDraft = (event: Event) => { if (dirty || busy.current) (event as CustomEvent<{ dirty: boolean }>).detail.dirty = true; };
    const beforeExit = (event: Event) => { if (open) { event.preventDefault(); void saveAndClose(); } };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('vcd:dev-has-draft', hasDraft);
    window.addEventListener('vcd:dev-mode-before-exit', beforeExit);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('vcd:dev-has-draft', hasDraft);
      window.removeEventListener('vcd:dev-mode-before-exit', beforeExit);
    };
  }, [drafts, notes, blocks, open, editing, text]);

  return <>
    {active && blocks.map((block) => {
      const key = keyFor(block);
      const hasNote = Boolean(notes[block.document]?.[block.id]?.text || drafts[key]);
      return createPortal(<button type="button" className={`dev-btn dev-btn--ghost dev-component-note-button${hasNote ? ' has-note' : ''}${loadErrors[block.document] || (error && editing && keyFor(editing) === key) ? ' has-error' : ''}`}
        aria-label={loadErrors[block.document] ? 'Retry loading notes' : hasNote ? 'Edit note' : 'Add note'}
        aria-haspopup="dialog" aria-expanded={Boolean(open && editing && keyFor(editing) === key)}
        aria-disabled={saving || undefined}
        disabled={(saving && (!editing || keyFor(editing) !== key)) || (!notes[block.document] && !loadErrors[block.document])}
        onClick={(event) => openNote(block, event.currentTarget)}
        dangerouslySetInnerHTML={{ __html: messageSquareIcon }} />, block.element, key);
    })}
    <Drawer.Root open={open} swipeDirection="down" onOpenChange={(next, details) => {
      if (!next) {
        if (busy.current) details.cancel();
        else void saveAndClose();
      }
    }}>
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="dev-component-note-backdrop" />
          <Drawer.Viewport ref={viewport} className="dev-component-note-viewport">
            <Drawer.Popup className="dev-component-note-drawer dev-surface" initialFocus={field} finalFocus={() => editing?.trigger || false} aria-busy={saving} aria-describedby={error ? 'component-note-error' : undefined}>
              <Drawer.Title className="sr-only">Note</Drawer.Title>
              <Drawer.Close className="dev-component-note-handle" aria-label="Close note" disabled={saving}><span /></Drawer.Close>
              <Drawer.Content className="dev-component-note-content" data-base-ui-swipe-ignore>
                <div className="dev-field__value">
                  <textarea ref={field} className="dev-field__input" aria-label="Note" placeholder="Note" rows={4} maxLength={8000}
                    value={text} readOnly={saving} onChange={(event) => {
                      setText(event.target.value);
                      if (editing) remember(editing, { text: event.target.value, revision: editing.baseline.revision });
                    }} />
                </div>
                {error && <p id="component-note-error" className="dev-component-note-error" role="alert">{error}</p>}
                {conflict && <div className="dev-component-note-conflict">
                  <button className="dev-btn dev-btn--ghost" type="button" disabled={saving} onClick={() => void saveAndClose(conflict.revision)}>Keep mine</button>
                  <button className="dev-btn dev-btn--ghost" type="button" disabled={saving} onClick={useSaved}>Use saved</button>
                </div>}
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  </>;
}
