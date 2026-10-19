/* La scheda "Sidechain" dei dispositivi che la accettano (il compressore): un menu con la
 * traccia che il rilevatore ascolta. Offre solo le tracce che non chiudono un anello (vedi
 * model/sidechain.ts); una scelta che non vale più (es. la traccia è entrata nel gruppo
 * ascoltato) resta nel menu, segnata, e il rilevatore intanto non sente niente. */
import type { TrackId } from '../../core/id';
import type { EffectSettings } from '../../model/device';
import type { ChainOwner, Project } from '../../model/project';
import { sidechainSources } from '../../model/sidechain';
import { el } from '../dom';

/** Il valore del menu per "nessuna traccia": il rilevatore ascolta il suono che passa. */
const OWN = '';

export class SidechainPicker {
  private readonly select = el<HTMLSelectElement>('select');
  readonly element = el('div', { className: 'device-section' },
    el('div', { className: 'device-section-title', textContent: 'Sidechain' }),
    el('div', { className: 'device-controls' },
      el('div', { className: 'choice' }, this.select, el('div', { className: 'knob-label', textContent: 'Ascolta' }))));
  /** Le voci del menu dell'ultima volta: si rifà solo se cambiano (un menu aperto resta aperto). */
  private shown = '';

  constructor(onChange: (source: TrackId | null) => void) {
    this.select.onchange = () => onChange(this.select.value === OWN ? null : this.select.value as TrackId);
  }

  update(p: Project, owner: ChainOwner, e: EffectSettings): void {
    const valid = new Set(sidechainSources(p, owner, e.id));
    const current = e.sidechain ?? OWN;
    const broken = !!e.sidechain && !valid.has(e.sidechain);
    const items: [string, string][] = [[OWN, '— sé stesso —'],
      ...p.channels.filter(t => valid.has(t.id) || t.id === e.sidechain)
        .map((t): [string, string] => [t.id, valid.has(t.id) ? t.name : `⚠ ${t.name}`])];
    const shown = JSON.stringify(items);
    if (shown !== this.shown) {
      this.select.replaceChildren(...items.map(([value, textContent]) => el('option', { value, textContent })));
      this.shown = shown;
    }
    this.select.value = current;
    this.select.title = broken
      ? 'Questa traccia riceve già il suono di questo canale: ascoltarla chiuderebbe un anello, quindi il rilevatore non sente niente. Scegline un\'altra.'
      : 'La traccia che il rilevatore ascolta, dopo i suoi effetti e prima del suo volume (es. la cassa che fa pompare il basso)';
  }
}
