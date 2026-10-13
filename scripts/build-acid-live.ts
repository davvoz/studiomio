/* Costruisce "Acido crudo" (src/demo/acid-live.ts) come cartella di progetto studiomio, con i
 * sample presi da una cartella di suoni:
 *   node scripts/run.mjs scripts/build-acid-live.ts <cartella dei suoni> <cartella del progetto>
 * La cartella del progetto si apre poi dall'app con "Apri". I file sono quelli della libreria
 * dell'utente (percorsi relativi a <cartella dei suoni>): cambiando questa tabella il live
 * suona con altri sample. */
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
  if (!soundsDir || !projectDir) throw new Error('uso: build-acid-live.ts <cartella dei suoni> <cartella del progetto>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildAcidLive);
}
