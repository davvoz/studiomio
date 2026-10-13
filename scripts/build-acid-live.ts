/* Costruisce "Acido crudo" (src/demo/acid-live.ts) come cartella di progetto studiomio, con i
 * sample presi da una cartella di suoni:
 *   node scripts/run.mjs scripts/build-acid-live.ts <cartella dei suoni> <cartella del progetto>
 * La cartella del progetto si apre poi dall'app con "Apri". I file sono quelli della libreria
 * dell'utente (percorsi relativi a <cartella dei suoni>): cambiando questa tabella il live
 * suona con altri sample. */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { sequentialIds } from '../src/core/id';
import { ACID_LIVE_SOUNDS, buildAcidLive, type AcidLiveSound } from '../src/demo/acid-live';
import { Project } from '../src/model/project';
import type { SampleRef } from '../src/model/sample';
import { ProjectFolder } from '../src/persistence/project-folder';
import { ProjectStore } from '../src/store/project-store';
import { NodeDirectory } from './node-directory';

const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA/nuovo fx';
const FX = 'fx-20250706T151918Z-1-001/fx';

const FILES: Readonly<Record<AcidLiveSound, string>> = {
  kick: `${DRUMS}/kick/kick ultim disto.wav`,
  kickHard: `${DRUMS}/kick/techKick1 disto.wav`,
  kickDeep: `${DRUMS}/kick/new Kick/Techno_kick_3.wav`,
  clap: `${DRUMS}/percussion/fr clap.wav`,
  snare: `${DRUMS}/snare/snare ultim disto.wav`,
  snareRoll: `${DRUMS}/snare/destorteed.wav`,
  hatClosed: `${DRUMS}/cymbals/hat close.wav`,
  hatOpen: `${DRUMS}/cymbals/hat open.wav`,
  ride: `${DRUMS}/cymbals/ride.wav`,
  hatAlt: `${DRUMS}/cymbals/HAT2 alfa.wav`,
  perc: `${DRUMS}/percussion/skull perc.wav`,
  metal: `${DRUMS}/percussion/metallic.wav`,
  tom: `${DRUMS}/percussion/frt tom.wav`,
  stab: `${ZEBRA}/metal one shot.wav`,
  crash: `${FX}/FX(2)/Crash.wav`,
  blast: `${FX}/FX(2)/blast.wav`,
  siren: `${FX}/allarmpolice.wav`,
  riser: `${ZEBRA}/rise da 3.wav`,
  downlifter: `${ZEBRA}/electraxnoise fall.wav`,
  sweepUp: `${ZEBRA}/oper up.wav`,
  laser: `${ZEBRA}/laser gladi.wav`,
};

/** Formato e lunghezza di un WAV dalla sua intestazione (PCM o float, anche "extensible"). */
function wavInfo(bytes: Uint8Array, name: string): { sampleRate: number; channels: number; frames: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${name}: non è un WAV`);
  let channels = 0, sampleRate = 0, bits = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), size = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(at + 10, true);
      sampleRate = v.getUint32(at + 12, true);
      bits = v.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (!channels || !bits) throw new Error(`${name}: manca il formato prima dei dati`);
      const size32 = Math.min(size, bytes.length - at - 8);
      return { sampleRate, channels: Math.min(2, channels), frames: Math.floor(size32 / (channels * (bits / 8))) };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${name}: nessun dato audio`);
}

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('uso: build-acid-live.ts <cartella dei suoni> <cartella del progetto>');
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('Acido crudo', ids), ids);
  const folder = new ProjectFolder(new NodeDirectory(projectDir));
  const sounds = {} as Record<AcidLiveSound, SampleRef>;
  for (const key of ACID_LIVE_SOUNDS) {
    const path = join(soundsDir, FILES[key]), name = basename(path);
    const bytes = new Uint8Array(await readFile(path));
    const info = wavInfo(bytes, name);
    const file = await folder.importAudio(name, bytes);
    sounds[key] = { id: ids.next('sample'), name: name.replace(/\.[^.]+$/, ''), file, ...info, analysis: null };
    console.log(`  ${key.padEnd(11)} ${name} (${(info.frames / info.sampleRate).toFixed(2)} s, ${info.sampleRate} Hz)`);
  }
  buildAcidLive(store, sounds);
  await folder.save(store.project);
  const p = store.project;
  console.log(`"${p.name}": ${p.tracks.length} tracce, ${p.scenes.length} scene, ${p.samples.length} sample, `
    + `${Math.max(...p.tracks.map(t => t.arrangementEnd)) / 4} battute sulla timeline → ${projectDir}`);
}
