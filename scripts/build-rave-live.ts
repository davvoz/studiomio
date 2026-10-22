/* Costruisce "Rave illegale" (src/demo/rave-live.ts) come cartella di progetto studiomio:
 *   node scripts/run.mjs scripts/build-rave-live.ts <cartella dei suoni> <cartella del progetto>
 * I file sono quelli della libreria dell'utente, del liveset "brehho23" e di "brehho23 rave",
 * relativi a <cartella dei suoni> (la cartella Musica). Per sentirlo e misurarlo senza browser:
 * scripts/render-project.ts sulla cartella creata. Per cambiare un suono basta cambiare il suo
 * file qui e rilanciare lo script. */
import { buildRaveLive, type RaveLiveSound } from '../src/demo/rave-live';
import { buildLiveFolder } from './live-folder';

const DRUMS = 'drum layer-20250622T160217Z-1-001/drum layer';
const ZEBRA = 'ZEBRA-20250731T121056Z-1-001/ZEBRA';
const FX = 'fx-20250706T151918Z-1-001/fx';
const BREHHO = 'studiomio/brehho23/audio';
const RAVE = 'studiomio/brehho23 rave/audio';

const FILES: Readonly<Record<RaveLiveSound, string>> = {
  // 1 cassa
  ancora: `${BREHHO}/ancora.wav`,
  corpus: `${DRUMS}/kick/kick corpus.wav`,
  secca: `${DRUMS}/kick/new Kick/Techno_kick_4.wav`,
  martello: `${DRUMS}/kick/newHardKick.wav`,
  distorta: `${DRUMS}/kick/kick ultim disto.wav`,
  industriale: `${DRUMS}/kick/techKick1 disto.wav`,
  gabber: `${ZEBRA}/component kick/hardcore kick3.wav`,
  boom: `${RAVE}/tk bigKick5.wav`,
  ferro: `${ZEBRA}/component kick/kick industrial.wav`,
  click: `${DRUMS}/kick/Floxy KIK-16.wav`,
  rimbombo: `${DRUMS}/kick/kick hard revrb.wav`,
  // 2 colpi
  clap: `${DRUMS}/percussion/fr clap.wav`,
  fruity: `${BREHHO}/fruity snare.wav`,
  omega: `${DRUMS}/snare/snare omega.wav`,
  grave: `${RAVE}/tk grave snare.wav`,
  reso: `${RAVE}/tk reso snare.wav`,
  destorto: `${RAVE}/tk snare destorteed.wav`,
  riverbero: `${DRUMS}/snare/snare revrb.wav`,
  ghost: `${DRUMS}/snare/snare dry2.wav`,
  trik: `${RAVE}/tk disto trik.wav`,
  metalHit: `${DRUMS}/cymbals/hit metallic.wav`,
  roll: `${DRUMS}/snare/snare attack3.wav`,
  slash: `${DRUMS}/snare/slash.wav`,
  // 3 piatti
  hatClosed: `${DRUMS}/cymbals/x close.wav`,
  hatSoft: `${DRUMS}/cymbals/hat close.wav`,
  hatOpen: `${DRUMS}/cymbals/hat open.wav`,
  ride: `${DRUMS}/cymbals/x ride.wav`,
  crash: `${DRUMS}/cymbals/x crash.wav`,
  tamb: `${DRUMS}/percussion/tamb.wav`,
  hatMetal: `${RAVE}/tk hat mettalic2.wav`,
  hatNoise: `${RAVE}/tk hat noise.wav`,
  hatAlfa: `${RAVE}/tk hat alfa.wav`,
  topLoop: `${RAVE}/electrax perc.wav`,
  // 6 sampler: metallo
  metal1: `${RAVE}/tk metallic.wav`,
  metal2: `${ZEBRA}/nuovo fx/metal one shot.wav`,
  cowbell: `${BREHHO}/frt cowbell.wav`,
  metallic: `${BREHHO}/metallic.wav`,
  pling: `${ZEBRA}/component/fx hit pling indu.wav`,
  metalDelay: `${ZEBRA}/nuovo percussive/metal delay.wav`,
  sciabola: `${ZEBRA}/nuovo fx/sciabola one shot.wav`,
  revMetal: `${ZEBRA}/nuovo fx/right rev metallic.wav`,
  // tamburi (il kit delle percussioni di brehho23)
  shot09: `${BREHHO}/One_Shot_09.wav`,
  tom: `${BREHHO}/frt tom.wav`,
  tom2: `${BREHHO}/frt tom2.wav`,
  wood: `${BREHHO}/fr perc.wav`,
  top: `${BREHHO}/frt top.wav`,
  skull: `${BREHHO}/skull perc.wav`,
  skull2: `${BREHHO}/skull perc2.wav`,
  shot17: `${BREHHO}/One_Shot_17.wav`,
  // macchine
  technoid: `${ZEBRA}/nuovo fx/technoid short.wav`,
  strangeHit: `${ZEBRA}/component/fx strange hit.wav`,
  robot: `${RAVE}/tk robot.wav`,
  growl: `${RAVE}/tk growl.wav`,
  laser: `${ZEBRA}/nuovo percussive/laser.wav`,
  laserRate: `${RAVE}/tk laserrate.wav`,
  glitch: `${ZEBRA}/nuovo percussive/glitcha 2.wav`,
  littleRobot: `${ZEBRA}/nuovo percussive/littlr robot.wav`,
  // voci
  kill: `${RAVE}/tk kill.wav`,
  darkness: `${ZEBRA}/film/fr voc darkness.wav`,
  whisper: `${ZEBRA}/film/chtulu sussurro.wav`,
  whisperF: `${ZEBRA}/film/sussurro femme.wav`,
  again: `${BREHHO}/again.wav`,
  medieval: `${ZEBRA}/vox medieval sppech.wav`,
  devil: `${ZEBRA}/fx vox devil reverb.wav`,
  choirYe: `${ZEBRA}/choir yehehe.wav`,
  // 7 rottura
  amen: `${ZEBRA}/drum loops/classic.wav`,
  raveBreak: 'brehho23 rave LOOPbreak.wav',
  decimated: `${RAVE}/tk decimated.wav`,
  glitcha: `${ZEBRA}/nuovo percussive/glitcha 3.wav`,
  // 8 lunghi: bordoni
  halfIntro: `${ZEBRA}/fx half intro.wav`,
  darknight: `${FX}/FX(2)/darknight.wav`,
  choirFx: `${ZEBRA}/melodic/choir fx.wav`,
  darkAtmos: `${ZEBRA}/fx dark atmos2.wav`,
  gladiator: `${ZEBRA}/nuovo fx/gladiator choir riprovo2.wav`,
  feedback: `${ZEBRA}/fx feedback.wav`,
  magicDelay: `${ZEBRA}/magic long fx delay.wav`,
  treno: `${FX}/TRENO.wav`,
  // salite, impatti, discese
  riseDa3: `${ZEBRA}/nuovo fx/rise da 3.wav`,
  noiseUp: `${ZEBRA}/nuovo fx/noise up operator.wav`,
  zebraUp: `${ZEBRA}/zebra up4.wav`,
  reverseNoise: `${ZEBRA}/REVERSE NOISE.wav`,
  cinematic: `${ZEBRA}/fx kick cinematic.wav`,
  blast: `${FX}/FX(2)/blast.wav`,
  crashFx: `${FX}/FX(2)/Crash.wav`,
  fall: `${ZEBRA}/nuovo fx/electraxnoise fall.wav`,
  downside: `${ZEBRA}/fx downside 132bpm.wav`,
  scendeDisto: `${ZEBRA}/SCENDE DISTO WBLI.wav`,
  goDown: `${ZEBRA}/fx decimam go down.wav`,
  finishBang: `${ZEBRA}/film/finish bang.wav`,
  // sirene e rumori
  siren: `${RAVE}/tk siren.wav`,
  sirenLead: `${ZEBRA}/virus/siren lead.wav`,
  allarm: `${FX}/allarm.wav`,
  strongNoise: `${RAVE}/tk strongnoise.wav`,
  autotreno: `${FX}/autotreno.wav`,
  space: `${ZEBRA}/fx space.wav`,
  hell: `${ZEBRA}/nuovo fx/Hell_s door.wav`,
  tension: `${ZEBRA}/nuovo fx/tension g.wav`,
};

export async function main([soundsDir, projectDir]: string[]): Promise<void> {
  if (!soundsDir || !projectDir) throw new Error('uso: build-rave-live.ts <cartella dei suoni> <cartella del progetto>');
  await buildLiveFolder(FILES, soundsDir, projectDir, buildRaveLive);
}
