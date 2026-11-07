import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyMapper } from '../../src/app/key-mapper';
import { keyboardBase, NoteKeyboard, NoteKeys } from '../../src/app/note-keyboard';
import type { DeviceId, TrackId } from '../../src/core/id';
import { DRUMS } from '../../src/devices/instruments/drums/drums';
import type { KeyMap } from '../../src/model/key-map';
import type { Project } from '../../src/model/project';
import { loadInstrument } from '../../src/store/browser-edits';
import type { ProjectStore } from '../../src/store/project-store';
import type { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

const A = 'a' as TrackId, B = 'b' as TrackId;

function rig(bases: Partial<Record<TrackId, number>> = {}) {
  const log: string[] = [], said: string[] = [];
  const keys = new NoteKeyboard({
    base: t => bases[t] ?? 60,
    press: (t, p, v) => log.push(`on ${t} ${p} ${v}`),
    release: (t, p) => log.push(`off ${t} ${p}`),
    say: text => said.push(text),
  });
  return { keys, log, said };
}

describe('NoteKeyboard', () => {
  it('la fila di mezzo sono i tasti bianchi, quella sopra i neri, come in Live', () => {
    const { keys, log } = rig();
    for (const code of ['KeyA', 'KeyW', 'KeyS', 'KeyJ', 'KeyK', 'Quote']) keys.down(code, [A]);
    expect(log).toEqual([60, 61, 62, 71, 72, 77].map(p => `on a ${p} 100`));
  });

  it('il rilascio spegne la nota partita, anche se intanto è cambiata l\'ottava', () => {
    const { keys, log } = rig();
    keys.down('KeyA', [A]);
    keys.down('KeyX', [A]);
    keys.up('KeyA');
    keys.down('KeyA', [A]);
    expect(log).toEqual(['on a 60 100', 'off a 60', 'on a 72 100']);
  });

  it('Z X cambiano ottava, C V la velocity, entro i limiti, e lo dicono', () => {
    const { keys, log, said } = rig();
    for (let i = 0; i < 9; i++) keys.down('KeyV', [A]);
    keys.down('KeyZ', [A]);
    keys.down('KeyA', [A]);
    expect(log).toEqual(['on a 48 127']);
    expect(said.at(-1)).toBe('Tastiera: ottava -1, velocity 127.');
  });

  it('suona tutte le tracce accese, ognuna dalla sua nota di base', () => {
    const { keys, log } = rig({ [B]: 36 });
    keys.down('KeyS', [A, B]);
    keys.up('KeyS');
    expect(log).toEqual(['on a 62 100', 'on b 38 100', 'off a 62', 'off b 38']);
  });

  it('le note fuori dalla gamma MIDI non partono', () => {
    const { keys, log } = rig({ [A]: 0 });
    keys.down('KeyZ', [A]);
    keys.down('KeyA', [A]);
    keys.up('KeyA');
    expect(log).toEqual([]);
  });

  it('spegne le note delle tracce che non ascoltano più, le altre restano', () => {
    const { keys, log } = rig();
    keys.down('KeyA', [A, B]);
    keys.keepTracks(new Set([B]));
    keys.up('KeyA');
    expect(log).toEqual(['on a 60 100', 'on b 60 100', 'off a 60', 'off b 60']);
  });

  it('releaseAll spegne tutto una volta sola', () => {
    const { keys, log } = rig();
    keys.down('KeyA', [A]);
    keys.down('KeyD', [A]);
    keys.releaseAll();
    keys.up('KeyA');
    expect(log).toEqual(['on a 60 100', 'on a 64 100', 'off a 60', 'off a 64']);
  });
});

describe('la tastiera accesa e i tasti mappati', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** La finestra con i due ascoltatori nell'ordine di app/app: A è mappato su una macro, Q anche. */
  function windowRig(on: boolean) {
    const listeners: ((e: KeyboardEvent) => void)[] = [];
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('addEventListener', (type: string, listener: (e: KeyboardEvent) => void) => {
      if (type === 'keydown') listeners.push(listener);
    });
    const target = { kind: 'macro', owner: 'master', rack: 'r' as DeviceId, index: 0 } as const;
    const keyMap: KeyMap = [{ key: 'KeyA', target }, { key: 'KeyQ', target: { ...target, index: 1 } }];
    const store = { project: { keyMap, racksOf: () => [] }, apply: vi.fn() };
    const ui = { keyboardTracks: new Set(on ? [A] : []), keyMapping: false, midiMapping: false, onChange: () => {} } as unknown as UiState;
    const { keys, log } = rig();
    new NoteKeys(ui, keys);
    new KeyMapper(store as unknown as ProjectStore, ui, () => {});
    const press = (code: string) => {
      let stopped = false;
      const e = {
        code, key: code.slice(-1).toLowerCase(), target: null, repeat: false, ctrlKey: false, metaKey: false, altKey: false,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; },
      } as unknown as KeyboardEvent;
      for (const listener of listeners) if (!stopped) listener(e);
    };
    return { press, store, log };
  }

  it('accesa, un tasto delle note suona anche se è mappato e non muove la macro', () => {
    const { press, store, log } = windowRig(true);
    press('KeyA');
    expect(log).toEqual(['on a 60 100']);
    expect(store.apply).not.toHaveBeenCalled();
  });

  it('accesa, un tasto mappato fuori dalle note muove la sua macro', () => {
    const { press, store, log } = windowRig(true);
    press('KeyQ');
    expect(log).toEqual([]);
    expect(store.apply).toHaveBeenCalled();
  });

  it('spenta, il tasto torna alla sua macro', () => {
    const { press, store, log } = windowRig(false);
    press('KeyA');
    expect(log).toEqual([]);
    expect(store.apply).toHaveBeenCalled();
  });
});

describe('keyboardBase', () => {
  it('un sintetizzatore parte dal Do centrale, una drum machine dal suo primo pad', () => {
    const r = setup({ midi: 1 });
    expect(keyboardBase(r.store.project, r.track(0))).toBe(60);
    r.store.apply(loadInstrument(r.track(0), DRUMS.type, DRUMS.label, DRUMS.presets[1]));
    expect(keyboardBase(r.store.project, r.track(0))).toBe(36);
  });

  it('una traccia che non c\'è parte dal Do centrale', () => {
    expect(keyboardBase({ track: () => undefined } as unknown as Project, A)).toBe(60);
  });
});
