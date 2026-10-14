/* Costruisce "Fuori dal corpo" (src/demo/fuori-live.ts) come cartella di progetto studiomio:
 *   node scripts/run.mjs scripts/build-fuori-live.ts <cartella dei suoni> <cartella del progetto>
 * I file sono quelli della libreria dell'utente, relativi a <cartella dei suoni>. */
import { buildFuoriLive, type FuoriLiveSound } from '../src/demo/fuori-live';
import { buildLiveFolder } from './live-folder';

const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA';
const REESE = `${ZEBRA}/REESE LOOP`;
const FX = `${ZEBRA}/nuovo fx`;

const FILES: Readonly<Record<FuoriLiveSound, string>> = {
  kick: `${DRUMS}/kick/kick disto1.wav`,
  snare: `${DRUMS}/snare/snare omega.wav`,
  clap: `${DRUMS}/percussion/fr clap.wav`,
  snareGhost: `${DRUMS}/snare/snare dry2.wav`,
  snareRoll: `${DRUMS}/snare/snare attack3.wav`,
  hatClosed: `${DRUMS}/cymbals/hat tec.wav`,
  hatShort: `${DRUMS}/cymbals/hat short.wav`,
  hatOpen: `${DRUMS}/cymbals/frt open.wav`,
  ride: `${DRUMS}/cymbals/x ride.wav`,
  hatNoise: `${DRUMS}/cymbals/hat noise.wav`,
  tick: `${DRUMS}/percussion/skull perc.wav`,
  tick2: `${DRUMS}/percussion/skull perc2.wav`,
  tick3: `${DRUMS}/percussion/skull perc3.wav`,
  metal: `${DRUMS}/cymbals/hit metallic.wav`,
  metal2: `${DRUMS}/cymbals/remost metallic.wav`,
  top: `${DRUMS}/percussion/frt top.wav`,
  strange: `${ZEBRA}/component/fx strange hit.wav`,
  tom: `${DRUMS}/percussion/frt tom.wav`,
  trik: `${DRUMS}/percussion/disto trik.wav`,
  megareese: `${REESE}/KNTKmegareeze SPZ2.wav`,
  hum: `${REESE}/harmor hum.wav`,
  wowowo: `${REESE}/Wowowo.wav`,
  cupostep: `${REESE}/cupostep.wav`,
  trash: `${REESE}/megareeze trash rtm.wav`,
  melo: `${REESE}/hrmor melo g g#.wav`,
  newBase: `${REESE}/reece new base.wav`,
  z3ta: `${REESE}/z3ta simple reese.wav`,
  harMod: `${REESE}/fr har mod2.wav`,
  drumShape: `${ZEBRA}/component/bass drun shape.wav`,
  tension: `${FX}/tension g.wav`,
  hell: `${FX}/Hell_s door.wav`,
  deepNoise: `${FX}/deep noise.wav`,
  tank: `${FX}/tank atmo.wav`,
  strangeDrone: `${FX}/strange drone.wav`,
  ambient: `${FX}/ambient massive.wav`,
  space: `${FX}/abient speiz ervrb.wav`,
  organ: `${FX}/darky organo.wav`,
  robotize: `${FX}/robotize.wav`,
  robotoid: `${FX}/robotoid.wav`,
  voxDel: `${FX}/vox del.wav`,
  chtulu: `${ZEBRA}/film/chtulu cut.wav`,
  cicle: `${ZEBRA}/film/terrible cicle.wav`,
  omg: `${ZEBRA}/film/o my god.wav`,
  riser: `${FX}/rise da 3.wav`,
  riserLow: `${FX}/oper up.wav`,
  riserNoise: `${FX}/noise up operator.wav`,
  fall: `${FX}/electraxnoise fall.wav`,
  impact: `${ZEBRA}/fx kick cinematic.wav`,
  reverseNoise: `${ZEBRA}/REVERSE NOISE.wav`,
  glitch: `${FX}/rt0 g35tch.wav`,
  crash: `${DRUMS}/cymbals/x crash.wav`,
};

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('uso: build-fuori-live.ts <cartella dei suoni> <cartella del progetto>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildFuoriLive);
}
