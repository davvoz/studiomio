/* Builds "Acido crudo" (src/demo/acid-live.ts) as a studiomio project folder, with the
 * samples taken from a sounds folder:
 *   node scripts/run.mjs scripts/build-acid-live.ts <sounds folder> <project folder>
 * The project folder is then opened from the app with "Open". The files are those of the
 * user's library (paths relative to <sounds folder>): changing this table the live
 * plays with other samples. */
import { buildAcidLive, type AcidLiveSound } from '../src/demo/acid-live';
import { buildLiveFolder } from './live-folder';

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

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('usage: build-acid-live.ts <sounds folder> <project folder>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildAcidLive);
}
