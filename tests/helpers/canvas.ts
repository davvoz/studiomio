/** A 2D context that does nothing and records the calls' names: for painting code run in Node. */
export function fakeContext(): CanvasRenderingContext2D & { readonly calls: string[] } {
  const calls: string[] = [];
  const target: Record<string | symbol, unknown> = { calls };
  return new Proxy(target, {
    get: (t, name) => {
      if (name in t) return t[name];
      if (name === 'measureText') return (s: string) => ({ width: s.length * 6 });
      return (..._args: unknown[]) => { calls.push(String(name)); };
    },
    set: (t, name, value) => { t[name] = value; return true; },
  }) as unknown as CanvasRenderingContext2D & { readonly calls: string[] };
}

/** A canvas of `width` × `height` CSS pixels drawing into a fake context (`ctx`). */
export function fakeCanvas(width: number, height: number) {
  const ctx = fakeContext();
  const canvas = { clientWidth: width, clientHeight: height, width: 0, height: 0, getContext: () => ctx };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}

/** Path2D for Node: only records that it was built. */
export class FakePath2D {
  readonly ops: string[] = [];
  moveTo() { this.ops.push('moveTo'); }
  lineTo() { this.ops.push('lineTo'); }
  closePath() { this.ops.push('closePath'); }
}
