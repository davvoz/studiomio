import { describe, expect, it } from 'vitest';
import { isIdentityReply, Liveness } from '../../src/control/liveness';

const REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x47, 0x29, 0x00, 0x19, 0x00, 0x01, 0x00, 0x00, 0xf7];
const NOTE = [0x90, 0x20, 0x7f];

describe('il controller risponde ancora?', () => {
  it('riconosce la risposta d\'identità', () => {
    expect(isIdentityReply(REPLY)).toBe(true);
    expect(isIdentityReply(NOTE)).toBe(false);
  });

  it('un controller che risponde: dopo il silenzio si chiede, e se tace è muto', () => {
    const l = new Liveness(0, false, 2000, 1500);
    l.heard(100, REPLY);
    expect(l.watching).toBe(true);
    expect(l.check(1000)).toBeNull();
    l.heard(1500, NOTE); // l'utente suona: niente richieste
    expect(l.check(3000)).toBeNull();
    expect(l.check(3600)).toBe('ping');
    expect(l.check(4000)).toBeNull(); // si aspetta la risposta
    l.heard(4100, REPLY);
    expect(l.check(5000)).toBeNull();
    expect(l.check(6200)).toBe('ping');
    expect(l.check(7800)).toBe('silent');
    // si ricomincia a contare: un altro giro di silenzio, un'altra richiesta
    expect(l.check(8000)).toBeNull();
    expect(l.check(9900)).toBe('ping');
  });

  it('un controller che la richiesta non la conosce non è mai dato per muto', () => {
    const l = new Liveness(0, false, 2000, 1500);
    expect(l.check(1600)).toBeNull(); // la prima richiesta (al collegamento) è senza risposta
    expect(l.watching).toBe(false);
    for (let t = 2000; t < 20_000; t += 500) expect(l.check(t)).toBeNull();
  });

  it('riaprendo le porte si sa già che risponde: il silenzio conta subito', () => {
    const l = new Liveness(0, true, 2000, 1500);
    expect(l.check(1600)).toBe('silent');
  });
});
