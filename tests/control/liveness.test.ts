import { describe, expect, it } from 'vitest';
import { isIdentityReply, Liveness } from '../../src/control/liveness';

const REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x47, 0x29, 0x00, 0x19, 0x00, 0x01, 0x00, 0x00, 0xf7];
const NOTE = [0x90, 0x20, 0x7f];

describe('is the controller still responding?', () => {
  it('recognizes the identity reply', () => {
    expect(isIdentityReply(REPLY)).toBe(true);
    expect(isIdentityReply(NOTE)).toBe(false);
  });

  it('a responding controller: after the silence it asks, and if it\'s silent it\'s mute', () => {
    const l = new Liveness(0, false, 2000, 1500);
    l.heard(100, REPLY);
    expect(l.watching).toBe(true);
    expect(l.check(1000)).toBeNull();
    l.heard(1500, NOTE); // the user plays: no requests
    expect(l.check(3000)).toBeNull();
    expect(l.check(3600)).toBe('ping');
    expect(l.check(4000)).toBeNull(); // waiting for the answer
    l.heard(4100, REPLY);
    expect(l.check(5000)).toBeNull();
    expect(l.check(6200)).toBe('ping');
    expect(l.check(7800)).toBe('silent');
    // counting starts again: another round of silence, another request
    expect(l.check(8000)).toBeNull();
    expect(l.check(9900)).toBe('ping');
  });

  it('a controller that doesn\'t know the request is never considered mute', () => {
    const l = new Liveness(0, false, 2000, 1500);
    expect(l.check(1600)).toBeNull(); // the first request (on connection) is without reply
    expect(l.watching).toBe(false);
    for (let t = 2000; t < 20_000; t += 500) expect(l.check(t)).toBeNull();
  });

  it('reopening the ports it\'s already known that it answers: silence counts right away', () => {
    const l = new Liveness(0, true, 2000, 1500);
    expect(l.check(1600)).toBe('silent');
  });
});
