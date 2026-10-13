/* Il suono del Limiter, con anticipo di L campioni:
 *
 *   1. guadagno richiesto r[n] = min(1, tetto / picco[n]): il picco dei due canali, e se chiesto
 *      quello ricostruito tra i campioni (true peak), misurato su una copia sovracampionata 4×;
 *   2. il minimo di r sugli ultimi L+1 campioni (finestra scorrevole, coda monotona);
 *   3. il rilascio: il guadagno scende subito, risale con la costante di rilascio;
 *   4. una media mobile lunga L: la discesa diventa una rampa che finisce proprio sul picco;
 *   5. il suono ritardato (di L, più il ritardo della misura sovracampionata) × quel guadagno,
 *      e per sicurezza un taglio al tetto.
 *
 * Ogni valore della media viene da campioni che coprono il picco ritardato, quindi il guadagno
 * applicato non supera mai quello richiesto: nessun picco oltre il tetto. Gira nell'AudioWorklet;
 * qui niente Web Audio, così si prova anche in Node. */
import { dbToGain, type EffectCore } from '../../dsp/core';
import { Oversampler } from '../../dsp/oversampler';
import { MAX_LOOKAHEAD_MS } from './limiter';

const SMOOTH = 0.02;
/** Sovracampionamento della misura dei picchi tra i campioni. */
const TRUE_PEAK_FACTOR = 4;

export class LimiterCore implements EffectCore {
  private readonly size: number;
  /** Il suono in attesa e i guadagni richiesti, in anelli lunghi `size`. */
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  private readonly wanted: Float32Array;
  /** Coda monotona per il minimo scorrevole: posizioni (assolute) dei candidati. */
  private readonly queue: Int32Array;
  private head = 0;
  private tail = 0;
  /** La media mobile: gli ultimi L valori e la loro somma. */
  private readonly boxBuf: Float64Array;
  private boxSum = 0;
  private count = 0;
  private lookahead = 1;
  private released = 1;
  private releaseK = 0;
  private ceiling = 1;
  private gain = 1;
  private targetGain = 1;
  private truePeak = true;
  private readonly smoothK: number;
  /** La misura tra i campioni: copie sovracampionate, il loro ritardo (intero, in campioni) e
   *  il picco del campione prima (ogni picco vale per due posizioni: copre il resto frazionario). */
  private readonly osL = new Oversampler(TRUE_PEAK_FACTOR);
  private readonly osR = new Oversampler(TRUE_PEAK_FACTOR);
  private readonly measureDelay: number;
  private lastPeak = 0;
  private scratchL = new Float32Array(128);
  private scratchR = new Float32Array(128);
  /** Prima del primo blocco il guadagno non scorre: parte da quello giusto. */
  private fresh = true;
  /** Il guadagno più basso dall'ultima lettura (per i misuratori e i test). */
  private minGain = 1;

  constructor(private readonly sampleRate: number) {
    // il ramo che sale da solo ritarda metà del giro su e giù
    this.measureDelay = Math.floor(this.osL.latency / 2);
    this.size = Math.ceil((MAX_LOOKAHEAD_MS / 1000) * sampleRate) + this.measureDelay + 8;
    this.delayL = new Float32Array(this.size);
    this.delayR = new Float32Array(this.size);
    this.wanted = new Float32Array(this.size).fill(1);
    this.queue = new Int32Array(this.size);
    this.boxBuf = new Float64Array(this.size).fill(1);
    this.smoothK = 1 - Math.exp(-1 / (SMOOTH * sampleRate));
    this.setParams({});
    this.resetBox();
  }

  /** Ritardo dell'effetto in campioni. */
  get latency(): number {
    return this.lookahead + (this.truePeak ? this.measureDelay : 0);
  }

  /** La riduzione più forte dall'ultima lettura, in dB (la lettura la azzera). */
  takeReduction(): number {
    const db = -20 * Math.log10(Math.max(this.minGain, 1e-6));
    this.minGain = 1;
    return db;
  }

  setParams(p: Readonly<Record<string, number>>): void {
    const v = (id: string, fallback: number) => p[id] ?? fallback;
    const lookahead = Math.max(1, Math.min(this.size - this.measureDelay - 8, Math.round((v('lookahead', 2) / 1000) * this.sampleRate)));
    const truePeak = v('truePeak', 1) === 1;
    if (lookahead !== this.lookahead || truePeak !== this.truePeak) {
      this.lookahead = lookahead;
      this.truePeak = truePeak;
      this.resetBox();
    }
    this.ceiling = dbToGain(v('ceiling', -0.3));
    this.targetGain = dbToGain(v('gain', 0));
    this.releaseK = 1 - Math.exp(-1 / ((v('release', 80) / 1000) * this.sampleRate));
    if (this.fresh) this.gain = this.targetGain;
  }

  setTempo(): void {}

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    if (this.scratchL.length < n) [this.scratchL, this.scratchR] = [new Float32Array(n), new Float32Array(n)];
    const xl = this.scratchL, xr = this.scratchR;
    let gain = this.gain;
    for (let i = 0; i < n; i++) {
      gain += (this.targetGain - gain) * this.smoothK;
      xl[i] = inL[i] * gain;
      xr[i] = inR[i] * gain;
    }
    this.gain = gain;
    this.fresh = false;
    const F = TRUE_PEAK_FACTOR, truePeak = this.truePeak;
    const upL = truePeak ? this.osL.up(xl, n) : xl, upR = truePeak ? this.osR.up(xr, n) : xr;
    const { size, delayL, delayR, wanted, queue, boxBuf, lookahead: L, ceiling, releaseK } = this;
    const delay = L + (truePeak ? this.measureDelay : 0);
    let { head, tail, boxSum, count, released, lastPeak, minGain } = this;
    for (let i = 0; i < n; i++) {
      // 1. il picco: dei campioni, o dei quattro sovracampionati che coprono questo intervallo
      let peak = 0;
      if (truePeak) {
        for (let j = i * F, end = j + F; j < end; j++) {
          const a = Math.abs(upL[j]), b = Math.abs(upR[j]);
          if (a > peak) peak = a;
          if (b > peak) peak = b;
        }
        const p = peak;
        if (lastPeak > peak) peak = lastPeak;
        lastPeak = p;
      } else peak = Math.max(Math.abs(xl[i]), Math.abs(xr[i]));
      const want = peak > ceiling ? ceiling / peak : 1;
      const at = count % size;
      delayL[at] = xl[i];
      delayR[at] = xr[i];
      wanted[at] = want;
      // 2. minimo scorrevole sugli ultimi L+1 (la coda tiene i candidati in ordine crescente)
      while (tail > head && wanted[queue[(tail - 1) % size] % size] >= want) tail--;
      queue[tail % size] = count;
      tail++;
      while (queue[head % size] < count - L) head++;
      const min = wanted[queue[head % size] % size];
      // 3. giù subito, su con il rilascio
      released = min < released ? min : released + (min - released) * releaseK;
      // 4. media mobile lunga L
      const slot = count % L;
      boxSum += released - boxBuf[slot];
      boxBuf[slot] = released;
      const g = boxSum / L;
      if (g < minGain) minGain = g;
      // 5. il suono di `delay` campioni fa
      const from = (count - delay + size) % size;
      let yl = delayL[from] * g, yr = delayR[from] * g;
      if (yl > ceiling) yl = ceiling; else if (yl < -ceiling) yl = -ceiling;
      if (yr > ceiling) yr = ceiling; else if (yr < -ceiling) yr = -ceiling;
      outL[i] = yl;
      outR[i] = yr;
      count++;
    }
    // gli indici assoluti restano piccoli: campioni e posizioni nella coda si spostano di
    // multipli di `size` e di L (gli anelli e la media non se ne accorgono)
    if (count > 1 << 30) {
      const step = size * L, shift = Math.floor((count - 2 * size) / step) * step;
      for (let k = head; k < tail; k++) queue[k % size] -= shift;
      count -= shift;
      const q = Math.floor(head / size) * size;
      head -= q;
      tail -= q;
    }
    this.head = head;
    this.tail = tail;
    this.boxSum = boxSum;
    this.count = count;
    this.released = released;
    this.lastPeak = lastPeak;
    this.minGain = minGain;
  }

  private resetBox(): void {
    this.boxBuf.fill(1);
    this.boxSum = this.lookahead;
    this.released = 1;
  }
}
