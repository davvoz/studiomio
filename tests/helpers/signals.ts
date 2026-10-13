/** Segnali di prova deterministici. */
export { drumLoop } from '../../src/demo/demo-loop';

export const SR = 44100;

export const maxAbsDiff = (a: readonly Float32Array[], b: readonly Float32Array[]): number => {
  let m = 0;
  a.forEach((x, c) => {
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - b[c][i]));
  });
  return m;
};
