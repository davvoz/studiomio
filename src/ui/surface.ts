/** Un canvas nitido anche su schermi ad alta densità. */
export class Surface {
  readonly canvas = document.createElement('canvas');
  readonly g = this.canvas.getContext('2d')!;
  width = 0;
  height = 0;

  constructor(className: string) {
    this.canvas.className = className;
  }

  resize(w: number, h: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
