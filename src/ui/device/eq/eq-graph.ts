/* Il disegno del grafico dell'EQ su canvas: griglia, spettro (prima e dopo l'EQ), la curva
 * di ogni banda e quella totale, i punti. Le curve si ricalcolano solo quando cambiano i
 * parametri; a ogni fotogramma si ridisegna con lo spettro nuovo. */
import { BAND_TYPES, type EqBand } from '../../../devices/effects/eq/eq';
import { bandResponseDb } from '../../../devices/effects/eq/eq-math';
import { EqScale, FREQ_GRID, spectrumColumns, SPECTRUM_BOTTOM } from './eq-scale';

export const BAND_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];

/** Distanza tra due punti delle curve, in pixel. */
const STEP = 2;
/** Raggio dei punti delle bande e distanza entro cui si prendono col mouse. */
const NODE_R = 7, HIT_R = 12;

export interface GraphState {
  readonly bands: readonly EqBand[];
  readonly output: number;
  readonly enabled: boolean;
  readonly selected: number;
  readonly hover: number | null;
  /** Testo in alto a sinistra (la banda sotto il mouse) e a destra (dove punta il mouse). */
  readonly label: string;
  readonly readout: string;
}

export interface Spectrum {
  readonly pre: Float32Array;
  readonly post: Float32Array;
  readonly sampleRate: number;
}

export class EqGraph {
  private scale = new EqScale(1, 1);
  /** Risposta in dB di ogni banda, per colonna, e la loro somma con l'uscita. */
  private curves: Float32Array[] = [];
  private total = new Float32Array(0);
  private curvesFor: { bands: readonly EqBand[]; output: number; width: number } | null = null;
  private columnsPre = new Float32Array(0);
  private columnsPost = new Float32Array(0);

  constructor(readonly canvas: HTMLCanvasElement, private readonly sampleRate: number) {}

  get geometry(): EqScale {
    return this.scale;
  }

  /** Il punto della banda: sulla sua frequenza, all'altezza del guadagno (i tagli sullo zero). */
  nodeAt(band: EqBand): { x: number; y: number } {
    return { x: this.scale.freqToX(band.freq), y: this.scale.dbToY(BAND_TYPES[band.type]?.gain ? band.gain : 0) };
  }

  /** La banda il cui punto è sotto (x, y), la più vicina; null se nessuna. */
  hit(bands: readonly EqBand[], x: number, y: number): number | null {
    let best: number | null = null, bestD = HIT_R;
    bands.forEach((b, i) => {
      const p = this.nodeAt(b), d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) [best, bestD] = [i, d];
    });
    return best;
  }

  draw(state: GraphState, spectrum: Spectrum | null): void {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) Object.assign(c, { width: Math.round(w * dpr), height: Math.round(h * dpr) });
    if (this.scale.width !== w || this.scale.height !== h) this.scale = new EqScale(w, h);
    this.updateCurves(state);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, w, h);
    this.grid(g);
    if (spectrum) this.spectrum(g, spectrum);
    this.bandFill(g, state);
    this.totalCurve(g, state);
    this.nodes(g, state);
    this.texts(g, state);
  }

  private updateCurves(state: GraphState): void {
    const { bands, output } = state, w = this.scale.width;
    const f = this.curvesFor;
    if (f && f.bands === bands && f.output === output && f.width === w) return;
    const n = Math.ceil(w / STEP) + 1;
    const freqs = Array.from({ length: n }, (_, i) => this.scale.xToFreq(i * STEP));
    this.curves = bands.map(b => Float32Array.from(freqs, fr => bandResponseDb(b, fr, this.sampleRate)));
    this.total = Float32Array.from(freqs, (_, i) => this.curves.reduce((db, curve) => db + curve[i], output));
    this.curvesFor = { bands, output, width: w };
  }

  private grid(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.scale;
    g.lineWidth = 1;
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'bottom';
    for (const [freq, label] of FREQ_GRID) {
      const x = Math.round(this.scale.freqToX(freq)) + 0.5;
      g.strokeStyle = label ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      if (label) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillText(label, x + 3, h - 2);
      }
    }
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    for (let db = -this.scale.range; db <= this.scale.range; db += 6) {
      const y = Math.round(this.scale.dbToY(db)) + 0.5;
      g.strokeStyle = db === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      if (db !== -this.scale.range && db !== this.scale.range) {
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillText(`${db > 0 ? '+' : ''}${db}`, w - 3, y - 6);
      }
    }
    g.textAlign = 'left';
  }

  private spectrum(g: CanvasRenderingContext2D, s: Spectrum): void {
    const n = Math.ceil(this.scale.width / STEP) + 1;
    if (this.columnsPre.length !== n) [this.columnsPre, this.columnsPost] = [new Float32Array(n), new Float32Array(n)];
    spectrumColumns(s.pre, s.sampleRate, this.scale, this.columnsPre);
    spectrumColumns(s.post, s.sampleRate, this.scale, this.columnsPost);
    const h = this.scale.height, step = this.scale.width / n;
    const path = (cols: Float32Array) => {
      const p = new Path2D();
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * step, freq = this.scale.xToFreq(x);
        const y = Math.min(h, this.scale.spectrumToY(Math.max(SPECTRUM_BOTTOM - 20, cols[i]), freq));
        if (i) p.lineTo(x, y);
        else p.moveTo(x, y);
      }
      return p;
    };
    // prima dell'EQ: una linea tenue; dopo: pieno
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 1;
    g.stroke(path(this.columnsPre));
    const post = path(this.columnsPost);
    g.strokeStyle = 'rgba(130,180,255,0.55)';
    g.stroke(post);
    post.lineTo((n - 0.5) * step, h);
    post.lineTo(0.5 * step, h);
    post.closePath();
    g.fillStyle = 'rgba(100,150,255,0.16)';
    g.fill(post);
  }

  private curvePath(values: Float32Array): Path2D {
    const p = new Path2D();
    values.forEach((db, i) => {
      const y = this.scale.dbToY(Math.max(-this.scale.range * 2, Math.min(this.scale.range * 2, db)));
      if (i) p.lineTo(i * STEP, y);
      else p.moveTo(0, y);
    });
    return p;
  }

  /** La banda scelta (o sotto il mouse): la sua curva riempita fino allo zero, nel suo colore. */
  private bandFill(g: CanvasRenderingContext2D, state: GraphState): void {
    const i = state.hover ?? state.selected, band = state.bands[i];
    if (!band?.on) return;
    const curve = this.curves[i], zero = this.scale.dbToY(0);
    const p = this.curvePath(curve);
    p.lineTo((curve.length - 1) * STEP, zero);
    p.lineTo(0, zero);
    p.closePath();
    g.fillStyle = `${BAND_COLORS[i]}2e`;
    g.fill(p);
  }

  private totalCurve(g: CanvasRenderingContext2D, state: GraphState): void {
    g.lineWidth = 2;
    g.strokeStyle = state.enabled ? '#ff9d2e' : 'rgba(255,255,255,0.35)';
    g.stroke(this.curvePath(this.total));
  }

  private nodes(g: CanvasRenderingContext2D, state: GraphState): void {
    g.font = 'bold 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    state.bands.forEach((band, i) => {
      const { x, y } = this.nodeAt(band), color = BAND_COLORS[i];
      g.beginPath();
      g.arc(x, y, NODE_R, 0, Math.PI * 2);
      g.fillStyle = band.on ? color : '#22262c';
      g.fill();
      g.lineWidth = i === state.selected ? 2 : 1;
      g.strokeStyle = i === state.selected ? '#fff' : band.on ? 'rgba(0,0,0,0.5)' : color;
      g.stroke();
      g.fillStyle = band.on ? '#141414' : color;
      g.fillText(String(i + 1), x, y + 0.5);
    });
    g.textAlign = 'left';
  }

  private texts(g: CanvasRenderingContext2D, state: GraphState): void {
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    if (state.label) g.fillText(state.label, 8, 6);
    if (state.readout) {
      g.textAlign = 'right';
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText(state.readout, this.scale.width - 26, 6);
      g.textAlign = 'left';
    }
  }
}
