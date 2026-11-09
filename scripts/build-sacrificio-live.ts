/* Builds "Sacrificio" (src/demo/sacrificio-live.ts) as a studiomio project folder:
 *   node scripts/run.mjs scripts/build-sacrificio-live.ts <sounds folder> <project folder>
 * The files are those of the user's library, relative to <sounds folder>. */
import { buildSacrificioLive, type SacrificioLiveSound } from '../src/demo/sacrificio-live';
import { buildLiveFolder } from './live-folder';

const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA';

const FILES: Readonly<Record<SacrificioLiveSound, string>> = {
  kick: `${ZEBRA}/component kick/kick industrial.wav`,
  kickAlt: `${ZEBRA}/component kick/kick hardly.wav`,
  clap: `${DRUMS}/snare/snare layer & compress.wav`,
  clapLayer: `${DRUMS}/snare/SNARMAXI.wav`,
  hatOpen: `${DRUMS}/cymbals/x open.wav`,
  hatClosed: `${DRUMS}/cymbals/hat close.wav`,
  ride: `${DRUMS}/cymbals/ride.wav`,
  hatMetal: `${DRUMS}/cymbals/hat mettalic.wav`,
  metalHit: `${ZEBRA}/ONE SHOT METALLIC.wav`,
  strangeHit: `${ZEBRA}/component/fx strange hit.wav`,
  plingHit: `${ZEBRA}/component/fx hit pling indu.wav`,
  metalShot: `${ZEBRA}/nuovo fx/metal one shot.wav`,
  atmos: `${ZEBRA}/atmos.wav`,
  choir: `${ZEBRA}/nuovo fx/gladiator choir riprovo2.wav`,
  monster: `${ZEBRA}/monster in void.wav`,
  kill: `${ZEBRA}/film/kill.wav`,
  sacrifice: `${ZEBRA}/film/fr5 speech sacrifice.wav`,
  dentro: `${ZEBRA}/film/ho visto qualcosa dentro di lei.wav`,
  whisper: `${ZEBRA}/film/sussurro femme.wav`,
  whisper2: `${ZEBRA}/film/chtulu sussurro.wav`,
  darkness: `${ZEBRA}/film/fr voc darkness.wav`,
  openFire: `${ZEBRA}/film/open fire.wav`,
  impact: `${ZEBRA}/fx kick cinematic.wav`,
  riser: `${ZEBRA}/zebra up4.wav`,
  reverseNoise: `${ZEBRA}/REVERSE NOISE.wav`,
  down: `${ZEBRA}/fx decimam go down.wav`,
  downDisto: `${ZEBRA}/SCENDE DISTO WBLI.wav`,
  obscure: `${ZEBRA}/FX OBSCURE.wav`,
};

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('usage: build-sacrificio-live.ts <sounds folder> <project folder>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildSacrificioLive);
}
