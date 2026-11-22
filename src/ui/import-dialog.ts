/* The window choosing what to import from another project: its tracks (indented in their groups),
 * its buses and the master's devices, and whether with the clips. A checked group brings all its
 * tracks: they're checked with it and can't be unchecked on their own. */
import type { TrackId } from '../core/id';
import { instrumentType } from '../devices/registry';
import type { ImportChoice } from '../model/project-import';
import type { Project } from '../model/project';
import { GroupTrack, MidiTrack, type Track } from '../model/track';
import { openDialog } from './dialog';
import { el } from './dom';

const KIND_LABELS: Readonly<Record<string, string>> = { audio: 'Audio', midi: 'MIDI', group: 'Group', bus: 'Bus' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the track has, in short: "MIDI · Analog · 3 effects · 1 rack · 4 clips". */
function trackDetail(t: Track): string {
  const kind = KIND_LABELS[t.kind] ?? t.kind;
  const parts = [t instanceof MidiTrack ? `${kind} · ${instrumentType(t.instrument.type)?.label ?? t.instrument.type}` : kind];
  if (t.effects.length) parts.push(count(t.effects.length, 'effect', 'effects'));
  if (t.racks.length) parts.push(count(t.racks.length, 'rack', 'racks'));
  if (t.clips.length) parts.push(count(t.clips.length, 'clip', 'clips'));
  return parts.join(' · ');
}

interface Row {
  readonly box: HTMLInputElement;
  readonly element: HTMLElement;
}

function row(name: string, detail: string, color: string | null, depth = 0): Row {
  const box = el<HTMLInputElement>('input', { type: 'checkbox' });
  const swatch = el('span', { className: 'import-swatch' });
  if (color) swatch.style.background = color;
  const element = el('label', { className: 'import-row' }, box, swatch, el('span', { className: 'import-name', textContent: name }),
    el('span', { className: 'import-detail', textContent: detail }));
  element.style.paddingLeft = `${depth * 18}px`;
  return { box, element };
}

/** A checked group checks (and locks) all the tracks it contains, also in its inner groups. */
function linkGroups(source: Project, rows: ReadonlyMap<TrackId, Row>): void {
  for (const g of source.tracks) {
    if (!(g instanceof GroupTrack)) continue;
    const group = rows.get(g.id)!.box;
    const inside = source.trackBlock(g.id).slice(1).map(t => rows.get(t.id)!.box);
    group.addEventListener('change', () => inside.forEach(b => Object.assign(b, { checked: group.checked, disabled: group.checked })));
  }
}

const section = (title: string, rows: readonly Row[]) =>
  (rows.length ? [el('h3', { className: 'import-section', textContent: title }), ...rows.map(r => r.element)] : []);

/** Asks what to take from `source`; null if the user gives up or chooses nothing. */
export async function chooseImport(source: Project, folderName: string): Promise<ImportChoice | null> {
  const tracks = new Map(source.tracks.map(t => [t.id, row(t.name, trackDetail(t), t.color, source.groupsOf(t.id).length)]));
  const buses = new Map(source.buses.map(b => [b.id, row(b.name, trackDetail(b), b.color)]));
  linkGroups(source, tracks);
  const fx = source.masterEffects.length;
  const master = row('Master chain', `${count(fx, 'effect', 'effects')} · ${count(source.masterRacks.length, 'rack', 'racks')}`, null);
  const clips = el<HTMLInputElement>('input', { type: 'checkbox' });
  const list = el('div', { className: 'import-list' },
    ...section('Tracks', [...tracks.values()]), ...section('Buses', [...buses.values()]), ...section('Master', fx ? [master] : []));
  const intro = el('p', { textContent: `What to bring from "${folderName}" (${source.tempo.bpm} BPM) into this project, with devices, racks, mixer and sends.` });
  const options = el('label', { className: 'import-row import-option' }, clips, 'Also the clips (timeline and session)');
  const answer = await openDialog('Import from project', [intro, list, options], [
    { label: 'Cancel', value: false },
    { label: 'Import', value: true, primary: true },
  ]);
  if (!answer) return null;
  const chosen = [...tracks, ...buses].filter(([, r]) => r.box.checked).map(([id]) => id);
  if (!chosen.length && !master.box.checked) return null;
  return { tracks: chosen, master: master.box.checked, clips: clips.checked };
}
