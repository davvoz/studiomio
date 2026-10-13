/* Costruisce "Siete pazzi" (src/demo/pazzi-live.ts) come cartella di progetto studiomio:
 *   node scripts/run.mjs scripts/build-pazzi-live.ts <cartella dei suoni> <cartella del progetto>
 * I file sono quelli della libreria dell'utente, relativi a <cartella dei suoni>. */
import { buildPazziLive, type PazziLiveSound } from '../src/demo/pazzi-live';
import { buildLiveFolder } from './live-folder';

const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA';
const FX = 'fx-20250706T151918Z-1-001/fx';
const STEMS = 'reese formant loop (Cover) Stems (175BPM)2';

const FILES: Readonly<Record<PazziLiveSound, string>> = {
  kick: `${DRUMS}/kick/snapkick punch.wav`,
  snare: `${DRUMS}/snare/snare jungl.wav`,
  snareBody: `${DRUMS}/snare/new snap snare.wav`,
  hatClosed: `${DRUMS}/cymbals/hat close.wav`,
  hatOpen: `${DRUMS}/cymbals/hat open.wav`,
  ride: `${DRUMS}/cymbals/ride.wav`,
  shaker: `${DRUMS}/percussion/tamb.wav`,
  amen: `${ZEBRA}/drum loops/classic.wav`,
  amenCrush: `${ZEBRA}/nuovo percussive/decimated.wav`,
  amenGlitch: `${ZEBRA}/nuovo percussive/glitcha.wav`,
  vocal: `${STEMS}/0 Lead Vocalscut.wav`,
  vocal2: `${STEMS}/0 Lead Vocals.wav`,
  pazzi: `${FX}/voxsiete pazzi.wav`,
  aiutarmi: `${FX}/volete aiutarmi!!.wav`,
  voiceCut: `${FX}/VOICECUT.wav`,
  vox: `${FX}/VOX1.wav`,
  stacco: `${FX}/FX vox stacco.wav`,
  riser: `${ZEBRA}/nuovo fx/rise da 3.wav`,
  sweepUp: `${ZEBRA}/nuovo fx/oper up.wav`,
  downlifter: `${ZEBRA}/nuovo fx/electraxnoise fall.wav`,
  crash: `${FX}/FX(2)/Crash.wav`,
  impact: `${FX}/FX(2)/blast.wav`,
  laser: `${ZEBRA}/nuovo fx/laser gladi.wav`,
  tension: `${ZEBRA}/nuovo fx/tension g.wav`,
};

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('uso: build-pazzi-live.ts <cartella dei suoni> <cartella del progetto>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildPazziLive);
}
