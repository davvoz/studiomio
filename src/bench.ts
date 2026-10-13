/* Banco di prova del motore DSP: verifica nel browser la catena completa
 * (server con COOP/COEP → memoria condivisa → worker pool → render). Non è l'interfaccia
 * dell'app, che arriverà con il modello del progetto e l'arrangement. */
import { drumLoop } from './demo/demo-loop';
import type { AudioAnalysis } from './dsp/analysis/analyze';
import type { StretchSettings, WarpMode } from './dsp/stretch/stretcher';
import type { WarpJob } from './dsp/stretch/warp-renderer';
import type { AudioData } from './dsp/types';
import { DspService } from './workers/dsp-service';
import { SupersededError } from './workers/worker-pool';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (line: string) => { $('log').textContent += `${line}\n`; };
const ms = (t0: number) => `${Math.round(performance.now() - t0)} ms`;

const dsp = new DspService();
let audioCtx: AudioContext | null = null;
let current: { audio: AudioData; analysis: AudioAnalysis; name: string } | null = null;
let rendered: Float32Array[] | null = null;
let playing: AudioBufferSourceNode | null = null;

/** Impostazioni predefinite di ogni modalità (le stesse di WarpMio). */
const defaultSettings: Record<WarpMode, (a: AudioAnalysis) => StretchSettings> = {
  complex: a => ({ mode: 'complex', fftSize: 4096, transients: a.transients }),
  beats: a => ({ mode: 'beats', slices: a.transients, loopMode: 'forward', envelope: 100 }),
  tones: () => ({ mode: 'tones', grainMs: 50 }),
  texture: () => ({ mode: 'texture', grainMs: 80, flux: 0.2 }),
  repitch: () => ({ mode: 'repitch' }),
};

function ctx(): AudioContext {
  audioCtx ??= new AudioContext();
  return audioCtx;
}

function buildJob(): WarpJob {
  const { audio, analysis } = current!;
  const len = audio.channels[0].length;
  const bpm = Number($<HTMLInputElement>('bpm').value) || analysis.tempo;
  const outLength = Math.round((len * analysis.tempo) / bpm);
  const mode = $<HTMLSelectElement>('mode').value as WarpMode;
  return {
    points: [[0, 0], [outLength, len]], outLength,
    transpose: Number($<HTMLInputElement>('transpose').value) || 0,
    settings: defaultSettings[mode](analysis),
  };
}

async function showEnvironment(): Promise<void> {
  const yes = (v: boolean, ok: string, ko: string) => `<span class="${v ? 'ok' : 'bad'}">${v ? ok : ko}</span>`;
  const info = await dsp.info();
  $('env').innerHTML = `
    <dt>Isolamento cross-origin</dt><dd>${yes(crossOriginIsolated, 'attivo', 'assente (servono le intestazioni COOP/COEP)')}</dd>
    <dt>SharedArrayBuffer</dt><dd>${yes(typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated, 'disponibile: i worker condividono i sample', 'non disponibile: i sample vengono copiati')}</dd>
    <dt>Core / worker DSP</dt><dd>${navigator.hardwareConcurrency} / ${dsp.workers}</dd>
    <dt>Implementazioni</dt><dd>${Object.entries(info).map(([m, impl]) => `${m}: ${impl}`).join(' · ')}</dd>`;
}

async function loadSource(name: string, audio: AudioData): Promise<void> {
  stop();
  rendered = null;
  const t0 = performance.now();
  await dsp.loadSource('preview', audio);
  const tLoad = ms(t0);
  const t1 = performance.now();
  const analysis = await dsp.analyze('preview');
  current = { audio, analysis, name };
  const secs = audio.channels[0].length / audio.sampleRate;
  $('source').textContent = `${name} · ${secs.toFixed(2)} s · ${audio.channels.length} canali · ${audio.sampleRate} Hz`;
  log(`Caricato "${name}" nei worker in ${tLoad}. Analisi: ${analysis.tempo} BPM, ${analysis.transients.length} transienti (${ms(t1)}).`);
  for (const id of ['render', 'parallel']) $<HTMLButtonElement>(id).disabled = false;
}

async function render(): Promise<void> {
  if (!current) return;
  const job = buildJob();
  const t0 = performance.now();
  try {
    rendered = await dsp.renderWarp('preview', job, 'preview');
  } catch (e) {
    if (e instanceof SupersededError) return;
    throw e;
  }
  const secs = job.outLength / current.audio.sampleRate;
  const took = performance.now() - t0;
  log(`Render ${job.settings.mode}: ${secs.toFixed(2)} s di audio in ${Math.round(took)} ms (${Math.round((secs * 1000) / took)}× tempo reale).`);
  $<HTMLButtonElement>('play').disabled = false;
}

/** Lo stesso render N volte insieme: misura quanto rende dividere il lavoro tra i core. */
async function renderParallel(): Promise<void> {
  if (!current) return;
  const job = buildJob(), n = dsp.workers;
  let t0 = performance.now();
  await dsp.renderWarp('preview', job);
  const single = performance.now() - t0;
  t0 = performance.now();
  await Promise.all(Array.from({ length: n }, () => dsp.renderWarp('preview', job)));
  const all = performance.now() - t0;
  log(`${n} render in parallelo: ${Math.round(all)} ms contro ${Math.round(single * n)} ms uno dopo l'altro → ${((single * n) / all).toFixed(1)}× più veloce.`);
}

function play(): void {
  if (playing) return stop();
  if (!rendered || !current) return;
  const c = ctx();
  const buf = c.createBuffer(rendered.length, rendered[0].length, current.audio.sampleRate);
  rendered.forEach((ch, i) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  playing = c.createBufferSource();
  playing.buffer = buf;
  playing.loop = true;
  playing.connect(c.destination);
  playing.start();
  $('play').textContent = '■';
}

function stop(): void {
  playing?.stop();
  playing = null;
  $('play').textContent = '▶';
}

async function decodeFile(file: File): Promise<AudioData> {
  const decoded = await ctx().decodeAudioData(await file.arrayBuffer());
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i).slice());
  return { channels, sampleRate: decoded.sampleRate };
}

const guard = (fn: () => Promise<void> | void) => () => {
  Promise.resolve(fn()).catch(e => log(`Errore: ${e instanceof Error ? e.message : e}`));
};

$('demo').addEventListener('click', guard(() => loadSource('Loop demo', { channels: drumLoop(4, 120), sampleRate: 44100 })));
$<HTMLInputElement>('file').addEventListener('change', guard(async () => {
  const file = $<HTMLInputElement>('file').files?.[0];
  if (file) await loadSource(file.name, await decodeFile(file));
}));
$('render').addEventListener('click', guard(render));
$('play').addEventListener('click', guard(play));
$('parallel').addEventListener('click', guard(renderParallel));
guard(showEnvironment)();

// ?auto: esegue da solo loop demo → render → render in parallelo (per le verifiche automatiche)
if (new URLSearchParams(location.search).has('auto')) {
  guard(async () => {
    await loadSource('Loop demo', { channels: drumLoop(4, 120), sampleRate: 44100 });
    await render();
    await renderParallel();
    log('FINE');
  })();
}
