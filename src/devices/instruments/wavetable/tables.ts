/* Le tabelle d'onda di Wavetable, generate qui (niente file): ognuna è una fila di FRAMES
 * forme d'onda di un periodo, e la posizione passa dall'una all'altra. Ogni forma è salvata in
 * LEVELS versioni, una per ottava, con sempre meno armoniche (come le mipmap di una texture):
 * una nota suona la versione che non ha nulla sopra Nyquist, così anche le note acute non si
 * ripiegano in aliasing. Le versioni nascono dallo spettro (FFT) della forma, togliendo le
 * armoniche di troppo. Dati puri: le usa il motore nell'AudioWorklet e il disegno del pannello. */
import { Fft } from '../../../dsp/fft';

/** Campioni per periodo. */
export const TABLE_SIZE = 2048;
/** Forme per tabella: la posizione va dalla prima (0 %) all'ultima (100 %). */
export const FRAMES = 16;
/** Versioni per ottava: la versione `l` ha fino a `maxHarmonic(l)` armoniche (1023, 512 … 1). */
export const LEVELS = 11;
/** Una forma di una versione occupa TABLE_SIZE + 1 campioni: l'ultimo ripete il primo, così
 *  l'interpolazione non deve tornare all'inizio. */
export const STRIDE = TABLE_SIZE + 1;

export const maxHarmonic = (level: number): number => Math.min(TABLE_SIZE / 2 - 1, (TABLE_SIZE / 2) >> level);

/** La versione da suonare con un passo di fase `dt` (frequenza / frequenza di campionamento):
 *  la più ricca la cui armonica più alta resta sotto Nyquist. */
export function levelFor(dt: number): number {
  const h = 0.5 / Math.max(dt, 1e-9);
  let level = 0;
  while (level < LEVELS - 1 && maxHarmonic(level) > h) level++;
  return level;
}

/** Una tabella: le forme come funzione del tempo (t in [0, 1), un periodo) o come ampiezze
 *  delle armoniche in seno (k da 1), per la posizione p in [0, 1]. */
type Shape =
  | { readonly time: (t: number, p: number) => number }
  | { readonly harmonics: (k: number, p: number) => number };

const TAU = 2 * Math.PI;
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
/** Le forme classiche, tutte in fase con sin(2πt) così sfumano l'una nell'altra senza buchi. */
const sine = (t: number) => Math.sin(TAU * t);
const triangle = (t: number) => (t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4);
const saw = (t: number) => (t === 0 ? 0 : 1 - 2 * t);
const square = (t: number) => (t === 0 || t === 0.5 ? 0 : t < 0.5 ? 1 : -1);

/** Le vocali A E I O U: tre formanti (Hz, dB), come in Neuro. */
const VOWELS: readonly (readonly (readonly [hz: number, db: number])[])[] = [
  [[780, 0], [1150, -4], [2800, -14]],
  [[420, 0], [1650, -9], [2650, -13]],
  [[290, 0], [2050, -12], [2950, -17]],
  [[460, 0], [820, -5], [2800, -20]],
  [[330, 0], [700, -10], [2500, -24]],
];
const FORMANT_WIDTH = [90, 110, 170];
/** Le vocali sono disegnate per questa fondamentale: suonando più in alto salgono con la nota. */
const VOWEL_F0 = 110;
/** I tiranti dell'organo: armoniche 1, 2, 3, 4, 6, 8, 5, 10, 12 nell'ordine in cui si aprono. */
const DRAWBARS = [1, 2, 3, 4, 6, 8, 5, 10, 12];

const vowelLevel = (k: number, p: number) => {
  const x = p * (VOWELS.length - 1), i = Math.min(VOWELS.length - 2, Math.floor(x)), f = x - i, hz = k * VOWEL_F0;
  let a = 0;
  for (let j = 0; j < 3; j++) {
    const center = lerp(VOWELS[i][j][0], VOWELS[i + 1][j][0], f), db = lerp(VOWELS[i][j][1], VOWELS[i + 1][j][1], f);
    a += Math.pow(10, db / 20) / (1 + ((hz - center) / FORMANT_WIDTH[j]) ** 2);
  }
  // un filo di fondamentale e di corpo, perché la nota resti riconoscibile
  return a + 0.25 / k;
};

/** Le tabelle, nell'ordine delle opzioni. */
export const TABLES: readonly { readonly name: string; readonly shape: Shape }[] = [
  {
    // seno → triangolo → dente di sega → quadra
    name: 'Base',
    shape: {
      time: (t, p) => {
        const x = p * 3, i = Math.min(2, Math.floor(x)), f = x - i, shapes = [sine, triangle, saw, square];
        return lerp(shapes[i](t), shapes[i + 1](t), f);
      },
    },
  },
  // impulso dal 50 % (quadra) al 4 %, senza continua
  { name: 'PWM', shape: { time: (t, p) => { const w = lerp(0.5, 0.04, p); return (t < w ? 1 : -1) - (2 * w - 1); } } },
  // un dente di sega con il filtro che si apre: da 1 a 512 armoniche
  { name: 'Armoniche', shape: { harmonics: (k, p) => (1 / k) / (1 + (k / Math.pow(2, p * 9)) ** 4) } },
  // il "sync": un dente di sega che riparte a ogni periodo, da 1 a 8 volte più veloce
  { name: 'Sync', shape: { time: (t, p) => { const r = 1 + 7 * p; return 1 - 2 * ((t * r) % 1); } } },
  // un seno ripiegato su sé stesso sempre di più (wavefolder)
  { name: 'Fold', shape: { time: (t, p) => Math.sin((Math.PI / 2) * sine(t) * (1 + 7 * p)) } },
  // FM a due operatori, rapporto 1: indice da 0 a 6
  { name: 'FM', shape: { time: (t, p) => Math.sin(TAU * t + 6 * p * sine(t)) } },
  // le vocali A E I O U
  { name: 'Vocale', shape: { harmonics: vowelLevel } },
  // i tiranti che si aprono uno dopo l'altro
  {
    name: 'Organo',
    shape: {
      harmonics: (k, p) => {
        const i = DRAWBARS.indexOf(k);
        return i < 0 ? 0 : Math.max(0, Math.min(1, p * DRAWBARS.length - i + 1)) * (i ? 0.7 : 1);
      },
    },
  },
  // un seno a scalini, sempre più grossi (riduzione della risoluzione e dei bit)
  {
    name: 'Digitale',
    shape: {
      time: (t, p) => {
        const steps = Math.round(Math.pow(2, lerp(7, 2, p))), levels = Math.pow(2, lerp(6, 1, p));
        return Math.round(sine((Math.floor(t * steps) + 0.5) / steps) * levels) / levels;
      },
    },
  },
  // un picco di risonanza che sale lungo le armoniche, dalla prima alla sessantaquattresima
  {
    name: 'Formanti',
    shape: {
      harmonics: (k, p) => {
        const center = Math.pow(2, p * 6), width = 0.6 + center * 0.18;
        return 0.15 / k + 1 / Math.pow(k, 0.3) / (1 + ((k - center) / width) ** 2);
      },
    },
  },
  // quadra (solo dispari) → dente di sega → quasi solo pari, un'ottava sopra
  {
    name: 'Spettrale',
    shape: {
      harmonics: (k, p) => {
        if (k === 1) return 1;
        const odd = p < 0.5 ? 1 : 1 - (p - 0.5) * 1.9, even = p < 0.5 ? 2 * p : 1;
        return (k % 2 ? odd : even) / k;
      },
    },
  },
  // armoniche tutte uguali, sempre di più (da 1 a 64): un ronzio che si apre
  { name: 'Additiva', shape: { harmonics: (k, p) => (k <= Math.round(Math.pow(2, p * 6)) ? 1 / Math.sqrt(k) : 0) } },
  // un lampo di seno sempre più breve e più veloce, poi silenzio
  {
    name: 'Pulsar',
    shape: {
      time: (t, p) => {
        const duty = lerp(1, 0.15, p);
        if (t >= duty) return 0;
        const x = t / duty;
        return Math.sin(TAU * x * (1 + 4 * p)) * Math.sin(Math.PI * x);
      },
    },
  },
  // FM a rapporto 2 ripiegata: il ringhio dei bassi
  {
    name: 'Growl',
    shape: { time: (t, p) => Math.sin((Math.PI / 2) * Math.sin(TAU * t + 5 * p * Math.sin(2 * TAU * t)) * (1 + 2.5 * p)) },
  },
  // tacche che scorrono nello spettro, come un pettine: suono metallico
  { name: 'Metallo', shape: { harmonics: (k, p) => Math.abs(Math.sin(k * (0.3 + 2.7 * p))) ** 3 / Math.sqrt(k) } },
  // un seno saturato sempre di più, fino alla quadra
  { name: 'Seno caldo', shape: { time: (t, p) => { const d = 1 + 15 * p * p; return Math.tanh(sine(t) * d) / Math.tanh(d); } } },
  // il dente di sega con le sue ottave sopra che entrano
  { name: 'Ottave', shape: { time: (t, p) => saw(t) + 0.7 * p * saw((2 * t) % 1) + 0.5 * p * p * saw((4 * t) % 1) } },
];

export const TABLE_NAMES = TABLES.map(t => t.name);

/** Tutte le versioni di tutte le forme: la forma `f` alla versione `l` comincia a
 *  `(f * LEVELS + l) * STRIDE`. */
export type Wavetable = Float32Array;

const cache = new Map<number, Wavetable>();

/** Le tabelle si calcolano la prima volta che servono (pochi millisecondi) e restano. */
export function wavetable(index: number): Wavetable {
  const i = Math.max(0, Math.min(TABLES.length - 1, Math.round(index)));
  let w = cache.get(i);
  if (!w) cache.set(i, (w = build(TABLES[i].shape)));
  return w;
}

function build(shape: Shape): Wavetable {
  const n = TABLE_SIZE;
  return buildFrames(FRAMES, (f, re, im, fft) => {
    const p = f / (FRAMES - 1);
    if ('time' in shape) {
      for (let i = 0; i < n; i++) re[i] = shape.time(i / n, p);
      fft.forward(re, im);
    } else {
      // seno di ampiezza a: −i·a·n/2 sull'armonica, il coniugato sul suo specchio
      for (let k = 1; k < n / 2; k++) {
        const a = shape.harmonics(k, p);
        im[k] = (-a * n) / 2;
        im[n - k] = (a * n) / 2;
      }
    }
  });
}

/** Quante forme al massimo in una tabella importata (le altre si saltano, prese a intervalli). */
export const MAX_IMPORTED_FRAMES = 64;

/** Una tabella da forme già pronte (es. un file WAV con un periodo ogni TABLE_SIZE campioni):
 *  ogni forma è un periodo di TABLE_SIZE campioni, e diventa le sue versioni per ottava come le
 *  tabelle generate. */
export function tableFromCycles(cycles: readonly ArrayLike<number>[]): Wavetable {
  return buildFrames(cycles.length, (f, re) => {
    const c = cycles[f];
    for (let i = 0; i < TABLE_SIZE; i++) re[i] = c[i] ?? 0;
  }, true);
}

/** I periodi di un suono importato come tabella: se è lungo un multiplo di TABLE_SIZE (il
 *  formato dei file wavetable) uno per pezzo; se è più corto di un periodo, lui stesso
 *  ricampionato; altrimenti pezzi presi a distanze uguali lungo il suono. Al massimo
 *  MAX_IMPORTED_FRAMES, i canali sommati. */
export function cyclesOf(channels: readonly Float32Array[]): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (!length) return [];
  const mono = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] / channels.length;
  if (length <= TABLE_SIZE) {
    // un periodo solo, allungato (interpolazione lineare, chiusa sul primo campione)
    const out = new Float32Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i++) {
      const x = (i * length) / TABLE_SIZE, j = Math.floor(x), t = x - j;
      out[i] = mono[j] + ((mono[(j + 1) % length] ?? 0) - mono[j]) * t;
    }
    return [out];
  }
  const whole = Math.floor(length / TABLE_SIZE);
  const exact = length % TABLE_SIZE === 0;
  const count = Math.min(MAX_IMPORTED_FRAMES, exact ? whole : Math.min(whole, 32));
  const out: Float32Array[] = [];
  for (let f = 0; f < count; f++) {
    // a pezzi interi (formato wavetable) o a distanze uguali lungo tutto il suono
    const index = exact ? Math.round((f * (whole - 1)) / Math.max(1, count - 1)) * TABLE_SIZE
      : Math.round((f * (length - TABLE_SIZE)) / Math.max(1, count - 1));
    out.push(mono.slice(index, index + TABLE_SIZE));
  }
  return out;
}

/** Le versioni per ottava di `count` forme: `fill` mette ogni forma nel tempo (in `re`, poi la
 *  trasforma con `fft`) o direttamente come spettro; con `fromTime` la trasformata la fa qui. */
function buildFrames(count: number, fill: (frame: number, re: Float64Array, im: Float64Array, fft: Fft) => void, fromTime = false): Wavetable {
  const n = TABLE_SIZE, fft = Fft.of(n);
  const out = new Float32Array(Math.max(1, count) * LEVELS * STRIDE);
  const specRe = new Float64Array(n), specIm = new Float64Array(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let f = 0; f < count; f++) {
    specRe.fill(0);
    specIm.fill(0);
    fill(f, specRe, specIm, fft);
    if (fromTime) fft.forward(specRe, specIm);
    specRe[0] = specIm[0] = specRe[n / 2] = specIm[n / 2] = 0; // niente continua né Nyquist
    let gain = 1;
    for (let l = 0; l < LEVELS; l++) {
      const h = maxHarmonic(l);
      re.fill(0);
      im.fill(0);
      for (let k = 1; k <= h; k++) {
        re[k] = specRe[k]; im[k] = specIm[k];
        re[n - k] = specRe[n - k]; im[n - k] = specIm[n - k];
      }
      fft.inverse(re, im);
      // tutte le versioni con il guadagno della più ricca: la forma arriva a ±1, e il volume
      // non cambia salendo con le note
      if (l === 0) {
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(re[i]));
        gain = peak > 1e-9 ? 1 / peak : 0;
      }
      const at = (f * LEVELS + l) * STRIDE;
      for (let i = 0; i < n; i++) out[at + i] = re[i] * gain;
      out[at + n] = out[at];
    }
  }
  return out;
}
