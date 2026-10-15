/* Costruisce "Prestabiliti" (src/demo/prestabiliti-live.ts) come cartella di progetto studiomio:
 *   node scripts/run.mjs scripts/build-prestabiliti-live.ts <cartella dei suoni> <cartella del progetto>
 * I file sono quelli della libreria dell'utente e del liveset "brehho23", relativi a
 * <cartella dei suoni> (la cartella Music). Il Robotoid del liveset è un mp3: serve la sua
 * copia WAV accanto (ffmpeg -i "Solo Robotoid Low Frequency.mp3" -ar 48000 -c:a pcm_s24le
 * "Solo Robotoid Low Frequency.wav"). Per sentirlo e misurarlo senza browser:
 * scripts/render-project.ts sulla cartella creata. */
import { buildPrestabilitiLive, type PrestabilitiLiveSound } from '../src/demo/prestabiliti-live';
import { buildLiveFolder } from './live-folder';

const BREHHO = 'studiomio/brehho23/audio';
const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA';

const FILES: Readonly<Record<PrestabilitiLiveSound, string>> = {
  kick: `${BREHHO}/ancora.wav`,
  kickGrit: `${ZEBRA}/component kick/kick industrial.wav`,
  clap: `${DRUMS}/percussion/fr clap.wav`,
  fruity: `${BREHHO}/fruity snare.wav`,
  snare: `${DRUMS}/snare/snare omega.wav`,
  ghost: `${DRUMS}/snare/snare dry2.wav`,
  hatClosed: `${DRUMS}/cymbals/x close.wav`,
  hatSoft: `${DRUMS}/cymbals/hat close.wav`,
  hatOpen: `${DRUMS}/cymbals/hat open.wav`,
  ride: `${DRUMS}/cymbals/x ride.wav`,
  crash: `${DRUMS}/cymbals/x crash.wav`,
  tamb: `${DRUMS}/percussion/tamb.wav`,
  shot09: `${BREHHO}/One_Shot_09.wav`,
  shot17: `${BREHHO}/One_Shot_17.wav`,
  shot18: `${BREHHO}/One_Shot_18.wav`,
  shot19: `${BREHHO}/One_Shot_19.wav`,
  shot23: `${BREHHO}/One_Shot_23.wav`,
  shot26: `${BREHHO}/One_Shot_26.wav`,
  tom: `${DRUMS}/percussion/frt tom.wav`,
  tick: `${DRUMS}/percussion/skull perc.wav`,
  metal: `${DRUMS}/percussion/metallic.wav`,
  robotoid: `${BREHHO}/Solo Robotoid Low Frequency.wav`,
  riser: `${ZEBRA}/fx wind up.wav`,
  reverseNoise: `${ZEBRA}/REVERSE NOISE.wav`,
  impact: `${ZEBRA}/fx kick cinematic.wav`,
  downlifter: `${ZEBRA}/fx downside 132bpm.wav`,
  monologue: `${BREHHO}/0 Lead Vocals.wav`,
  film: `${BREHHO}/terrible cicle.wav`,
  again: `${BREHHO}/again.wav`,
};

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('uso: build-prestabiliti-live.ts <cartella dei suoni> <cartella del progetto>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildPrestabilitiLive);
}
