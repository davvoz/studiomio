// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { MASTER } from '../../src/model/project';
import { addBus, addEffect, addMidiClip, groupTracks, removeEffect } from '../../src/store/edits';
import { chooseImport } from '../../src/ui/import-dialog';
import { setup } from '../helpers/fixtures';

afterEach(() => document.body.replaceChildren());

/** A project with a MIDI track (an effect, a clip) and an audio track in a group, an audio track alone and a bus. */
function source() {
  const s = setup({ midi: 1, audio: 2 });
  // setup adds the audio tracks first
  const [audio, alone, midi] = [s.track(0), s.track(1), s.track(2)];
  s.store.apply(addEffect(midi, 'delay', 'Delay'));
  s.store.apply(addMidiClip(midi, 0, 4));
  s.store.apply(groupTracks([midi, audio]));
  s.store.apply(addBus());
  return { project: s.store.project, midi, audio, alone };
}

const dialog = () => document.querySelector('dialog')!;
const rows = () => [...dialog().querySelectorAll<HTMLLabelElement>('.import-row:not(.import-option)')];
const box = (name: string) => rows().find(r => r.querySelector('.import-name')!.textContent === name)!.querySelector('input')!;
const clipsBox = () => dialog().querySelector<HTMLInputElement>('.import-option input')!;
const press = (label: string) => [...dialog().querySelectorAll('footer button')].find(b => b.textContent === label)!.dispatchEvent(new MouseEvent('click'));
const check = (b: HTMLInputElement, on = true) => { b.checked = on; b.dispatchEvent(new Event('change')); };

describe('import dialog', () => {
  it('lists the tracks indented in their groups, with what they have, the buses and the master', async () => {
    const { project, midi, audio, alone } = source();
    const answer = chooseImport(project, 'Other');
    expect(dialog().querySelector('p')!.textContent).toContain('"Other" (120 BPM)');
    expect([...dialog().querySelectorAll('.import-section')].map(h => h.textContent)).toEqual(
      project.masterEffects.length ? ['Tracks', 'Buses', 'Master'] : ['Tracks', 'Buses'],
    );
    const shown = (name: string) => {
      const r = box(name).closest('label')!;
      return [r.querySelector('.import-detail')!.textContent, r.style.paddingLeft];
    };
    const group = project.tracks.find(t => t.kind === 'group')!;
    expect(shown(group.name)).toEqual(['Group', '0px']);
    const [midiDetail, midiIndent] = shown(project.track(midi)!.name);
    expect(midiDetail).toMatch(/^MIDI · .+ · 1 effect · 1 clip$/);
    expect(midiIndent).toBe('18px');
    expect(shown(project.track(audio)!.name)).toEqual(['Audio', '18px']);
    expect(shown(project.track(alone)!.name)).toEqual(['Audio', '0px']);
    expect(shown(project.buses[0].name)).toEqual(['Bus', '0px']);
    press('Cancel');
    expect(await answer).toBeNull();
  });

  it('a checked group checks and locks its tracks; the answer has the chosen tracks, the master and the clips', async () => {
    const { project, midi, audio, alone } = source();
    const group = project.tracks.find(t => t.kind === 'group')!;
    const answer = chooseImport(project, 'Other');
    check(box(group.name));
    const inside = [box(project.track(midi)!.name), box(project.track(audio)!.name)];
    expect(inside.map(b => [b.checked, b.disabled])).toEqual([[true, true], [true, true]]);
    check(box(group.name), false);
    expect(inside.map(b => [b.checked, b.disabled])).toEqual([[false, false], [false, false]]);
    check(box(project.track(alone)!.name));
    check(clipsBox());
    const master = rows().find(r => r.querySelector('.import-name')!.textContent === 'Master chain');
    if (master) check(master.querySelector('input')!);
    press('Import');
    expect(await answer).toEqual({ tracks: [alone], master: !!master, clips: true });
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('nothing chosen is like giving up', async () => {
    const answer = chooseImport(source().project, 'Other');
    press('Import');
    expect(await answer).toBeNull();
  });

  it('the master alone, and without effects on the master no master row', async () => {
    const s = setup({ audio: 1 });
    s.store.apply(addEffect(MASTER, 'delay', 'Delay'));
    let answer = chooseImport(s.store.project, 'Other');
    expect(box('Master chain').closest('label')!.querySelector('.import-detail')!.textContent).toMatch(/effects? · 0 racks$/);
    check(box('Master chain'));
    press('Import');
    expect(await answer).toEqual({ tracks: [], master: true, clips: false });
    for (const e of s.store.project.masterEffects) s.store.apply(removeEffect(MASTER, e.id));
    answer = chooseImport(s.store.project, 'Other');
    expect(rows().some(r => r.textContent!.includes('Master chain'))).toBe(false);
    expect([...dialog().querySelectorAll('.import-section')].map(h => h.textContent)).toEqual(['Tracks']);
    press('Cancel');
    await answer;
  });
});
