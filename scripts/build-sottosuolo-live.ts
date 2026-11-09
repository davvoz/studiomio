/* Builds "Sottosuolo" (src/demo/sottosuolo-live.ts) as a studiomio project folder:
 *   node scripts/run.mjs scripts/build-sottosuolo-live.ts <sounds folder> <project folder>
 * The files are those of the user's library, relative to <sounds folder>. To hear and
 * measure it without a browser: scripts/render-project.ts on the created folder. */
import { buildSottosuoloLive, type SottosuoloLiveSound } from '../src/demo/sottosuolo-live';
import { buildLiveFolder } from './live-folder';

const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA';
const FX = `${ZEBRA}/nuovo fx`;

const FILES: Readonly<Record<SottosuoloLiveSound, string>> = {
  kickBody: `${DRUMS}/kick/new Kick/Techno_kick_4.wav`,
  kickGrit: `${ZEBRA}/component kick/kick industrial.wav`,
  kickRumble: `${DRUMS}/kick/kick ultim disto.wav`,
  clap: `${DRUMS}/percussion/fr clap.wav`,
  snare: `${DRUMS}/snare/snare omega.wav`,
  ghost: `${DRUMS}/snare/snare dry2.wav`,
  hatClosed: `${DRUMS}/cymbals/x close.wav`,
  hatSoft: `${DRUMS}/cymbals/hat close.wav`,
  hatOpen: `${DRUMS}/cymbals/hat open.wav`,
  ride: `${DRUMS}/cymbals/x ride.wav`,
  tamb: `${DRUMS}/percussion/tamb.wav`,
  tom: `${DRUMS}/percussion/frt tom.wav`,
  tom2: `${DRUMS}/percussion/frt tom2.wav`,
  tick: `${DRUMS}/percussion/skull perc.wav`,
  tick2: `${DRUMS}/percussion/skull perc2.wav`,
  metal: `${DRUMS}/percussion/metallic.wav`,
  wood: `${DRUMS}/percussion/fr perc.wav`,
  hitMetal: `${DRUMS}/cymbals/hit metallic.wav`,
  drone: `${ZEBRA}/fx half intro.wav`,
  choir: `${ZEBRA}/melodic/try gladi.wav`,
  darkAtmos: `${ZEBRA}/fx dark atmos2.wav`,
  airAtmos: `${ZEBRA}/fx atmos.wav`,
  darkness: `${ZEBRA}/film/fr voc darkness.wav`,
  whisper: `${ZEBRA}/film/sussurro femme.wav`,
  whisper2: `${ZEBRA}/film/chtulu sussurro.wav`,
  devil: `${ZEBRA}/fx vox devil reverb.wav`,
  riser: `${ZEBRA}/fx wind up.wav`,
  reverseNoise: `${ZEBRA}/REVERSE NOISE.wav`,
  impact: `${ZEBRA}/fx kick cinematic.wav`,
  downlifter: `${ZEBRA}/fx downside 132bpm.wav`,
  crash: `${DRUMS}/cymbals/x crash.wav`,
  fall: `${FX}/electraxnoise fall.wav`,
};

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('usage: build-sottosuolo-live.ts <sounds folder> <project folder>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildSottosuoloLive);
}
