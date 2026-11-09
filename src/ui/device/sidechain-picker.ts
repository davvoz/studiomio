/* The "Sidechain" tab of the devices accepting it (the compressor): a menu with the
 * track the detector listens to. It offers only the tracks that don't close a loop (see
 * model/sidechain.ts); a choice that no longer applies (e.g. the track entered the listened
 * group) stays in the menu, marked, and the detector meanwhile hears nothing. */
import type { TrackId } from '../../core/id';
import type { EffectSettings } from '../../model/device';
import type { ChainOwner, Project } from '../../model/project';
import { sidechainSources } from '../../model/sidechain';
import { el } from '../dom';

/** The menu's value for "no track": the detector listens to the sound passing through. */
const OWN = '';

export class SidechainPicker {
  private readonly select = el<HTMLSelectElement>('select');
  readonly element = el('div', { className: 'device-section' },
    el('div', { className: 'device-section-title', textContent: 'Sidechain' }),
    el('div', { className: 'device-controls' },
      el('div', { className: 'choice sidechain-choice' }, this.select, el('div', { className: 'knob-label', textContent: 'Listen' }))));
  /** The menu items of last time: it's redone only if they change (an open menu stays open). */
  private shown = '';

  constructor(onChange: (source: TrackId | null) => void) {
    this.select.onchange = () => onChange(this.select.value === OWN ? null : this.select.value as TrackId);
  }

  update(p: Project, owner: ChainOwner, e: EffectSettings): void {
    const valid = new Set(sidechainSources(p, owner, e.id));
    const current = e.sidechain ?? OWN;
    const broken = !!e.sidechain && !valid.has(e.sidechain);
    const items: [string, string][] = [[OWN, '— itself —'],
      ...p.channels.filter(t => valid.has(t.id) || t.id === e.sidechain)
        .map((t): [string, string] => [t.id, valid.has(t.id) ? t.name : `⚠ ${t.name}`])];
    const shown = JSON.stringify(items);
    if (shown !== this.shown) {
      this.select.replaceChildren(...items.map(([value, textContent]) => el('option', { value, textContent })));
      this.shown = shown;
    }
    this.select.value = current;
    this.select.title = broken
      ? 'This track already receives this channel\'s sound: listening to it would close a loop, so the detector hears nothing. Choose another one.'
      : 'The track the detector listens to, after its effects and before its volume (e.g. the kick making the bass pump)';
  }
}
