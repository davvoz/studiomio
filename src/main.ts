/* Pagina provvisoria del motore di riproduzione: un progetto demo con trasporto, tempo,
 * loop, metronomo, mixer ed export. L'interfaccia vera (arrangement) arriva nella fase 4. */
import { AudioSystem } from './app/audio-system';
import { randomIds } from './core/id';
import { buildDemoProject } from './demo/demo-project';
import { onsetEnvelope } from './dsp/analysis/onset';
import { detectTransients } from './dsp/analysis/transients';
import { encodeWav } from './dsp/codec/wav';
import { mixMono } from './dsp/signal';
import { Project } from './model/project';
import type { Track } from './model/track';
import { setLoopRegion, setMixer, setTempo } from './store/edits';
import { ProjectStore } from './store/project-store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (line: string) => { $('log').textContent += `${line}\n`; };

const store = new ProjectStore(Project.empty('Demo', randomIds), randomIds);
const audio = new AudioSystem(store);
const { engine } = audio;

// ------------------------------------------------------------------ viste

function renderTracks(): void {
  const p = store.project;
  $('tracks').replaceChildren(...p.tracks.map(trackRow));
}

function trackRow(t: Track): HTMLElement {
  const row = document.createElement('div');
  row.className = 'track';
  row.style.setProperty('--color', t.color);
  const toggle = (label: string, on: boolean, patch: () => object) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('on', on);
    b.onclick = () => store.apply(setMixer(t.id, patch()));
    return b;
  };
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '-40'; vol.max = '6'; vol.step = '0.5';
  vol.value = String(t.mixer.volumeDb);
  // il trascinamento del cursore è un solo passo di annullamento
  vol.oninput = () => store.apply(setMixer(t.id, { volumeDb: Number(vol.value) }), { mergeKey: `vol-${t.id}` });
  vol.onchange = () => store.endMerge();
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = `${t.name} · ${t.arrangement.length} clip`;
  const db = document.createElement('span');
  db.className = 'muted';
  db.textContent = `${t.mixer.volumeDb.toFixed(1)} dB`;
  row.append(name, toggle('M', t.mixer.mute, () => ({ mute: !t.mixer.mute })), toggle('S', t.mixer.solo, () => ({ solo: !t.mixer.solo })), vol, db);
  return row;
}

function renderTransport(): void {
  const p = store.project;
  $<HTMLInputElement>('bpm').value = String(p.tempo.bpm);
  $<HTMLInputElement>('loop').checked = p.loop.enabled;
  $<HTMLButtonElement>('undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('redo').disabled = !store.canRedo;
  $('undo').title = store.undoLabel ? `Annulla ${store.undoLabel}` : '';
  $('redo').title = store.redoLabel ? `Ripeti ${store.redoLabel}` : '';
}

function animatePosition(): void {
  $('pos').textContent = store.project.signature.format(engine.position);
  requestAnimationFrame(animatePosition);
}

// ------------------------------------------------------------------ azioni

async function togglePlay(): Promise<void> {
  if (engine.playing) engine.stop();
  else await audio.play(0);
}

async function exportMix(): Promise<void> {
  const end = store.project.arrangementEnd;
  const t0 = performance.now();
  const mix = await audio.exportMix(0, end);
  log(`Mix esportato: ${(mix[0].length / audio.context.sampleRate).toFixed(2)} s in ${Math.round(performance.now() - t0)} ms.`);
  const url = URL.createObjectURL(new Blob([encodeWav(mix, audio.context.sampleRate, 24)], { type: 'audio/wav' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${store.project.name}.wav` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const guard = (fn: () => unknown) => () => {
  Promise.resolve().then(fn).catch(e => log(`Errore: ${e instanceof Error ? e.message : e}`));
};

store.onChange(() => { renderTracks(); renderTransport(); });
engine.onStateChange(p => { $('play').textContent = p ? '■ Stop' : '▶ Play'; });
$('play').onclick = guard(togglePlay);
$('export').onclick = guard(exportMix);
$('undo').onclick = () => store.undo();
$('redo').onclick = () => store.redo();
$<HTMLInputElement>('bpm').onchange = guard(() => store.apply(setTempo(Number($<HTMLInputElement>('bpm').value))));
$<HTMLInputElement>('loop').onchange = () => store.apply(setLoopRegion({ enabled: $<HTMLInputElement>('loop').checked, start: 0, end: 16 }));
$<HTMLInputElement>('metro').onchange = () => { engine.metronomeOn = $<HTMLInputElement>('metro').checked; };
document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') { e.preventDefault(); guard(togglePlay)(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
});

// ------------------------------------------------------------------ avvio

guard(async () => {
  const t0 = performance.now();
  await buildDemoProject(store, audio);
  store.load(store.project); // il progetto demo non si annulla
  log(`Progetto demo pronto in ${Math.round(performance.now() - t0)} ms (${audio.dsp.workers} worker DSP).`);
  for (const id of ['play', 'export']) $<HTMLButtonElement>(id).disabled = false;
  renderTracks();
  renderTransport();
  animatePosition();
  if (new URLSearchParams(location.search).has('auto')) await selfCheck();
})();

/** ?auto: verifica da sola riproduzione dal vivo ed export (per i controlli automatici). */
async function selfCheck(): Promise<void> {
  await audio.play(0);
  await new Promise(r => setTimeout(r, 1500));
  log(`Dal vivo: dopo 1,5 s la testina è a ${engine.position.toFixed(2)} battiti (attesi ~2,9 a 120 BPM).`);
  engine.stop();

  store.apply(setTempo(100));
  store.apply(setMixer(store.project.tracks[0].id, { solo: true }));
  const sr = audio.context.sampleRate;
  const mix = await audio.exportMix(0, 16);
  const onsets = detectTransients(mixMono(mix), onsetEnvelope(mixMono(mix), sr), 0.5).map(i => i / sr);
  // la batteria ha una cassa su ogni battito: a 100 BPM uno ogni 0,6 s
  const errors = Array.from({ length: 16 }, (_, b) => Math.min(...onsets.map(t => Math.abs(t - b * 0.6))));
  const ok = errors.filter(e => e < 0.012).length;
  log(`Export a 100 BPM: ${(mix[0].length / sr).toFixed(2)} s; colpi sul battito: ${ok}/16, errore massimo ${(Math.max(...errors) * 1000).toFixed(1)} ms.`);
  store.undo();
  store.undo();
  log(`Annulla ×2: tempo ${store.project.tempo.bpm} BPM, solo ${store.project.tracks[0].mixer.solo}.`);
  log('FINE');
}
