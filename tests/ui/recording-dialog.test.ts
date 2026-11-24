// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_RECORD_QUANTIZE, type RecordQuantize } from '../../src/model/record-settings';
import { showRecordingSettings } from '../../src/ui/recording-dialog';

afterEach(() => document.body.replaceChildren());

function open(quantize: RecordQuantize = NO_RECORD_QUANTIZE) {
  const settings = { quantize, setQuantize: vi.fn<(q: RecordQuantize) => void>(), audioMs: 23, offsetMs: 10, moves: false };
  const closed = showRecordingSettings(settings);
  const dialog = document.querySelector('dialog')!;
  const control = (label: string) =>
    [...dialog.querySelectorAll('.recording-row')].find(r => r.querySelector('.recording-label')!.textContent === label)!
      .querySelector<HTMLInputElement & HTMLSelectElement>('input, select')!;
  const change = (c: HTMLElement) => c.dispatchEvent(new Event('change'));
  return { settings, closed, dialog, control, change };
}

describe('recording settings', () => {
  it('shows the project\'s quantization; off, its other controls are disabled', async () => {
    const w = open();
    expect(w.control('Grid').value).toBe('off');
    expect([...w.control('Grid').options].map(o => o.textContent)).toEqual(['Off', '1/4', '1/8', '1/16', '1/32']);
    for (const label of ['Triplets', 'Strength', 'Note ends too']) expect(w.control(label).disabled, label).toBe(true);
    w.dialog.querySelector<HTMLButtonElement>('footer button')!.click();
    await w.closed;
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('every change applies at once', () => {
    const w = open({ grid: '1/16', triplet: false, strength: 0.75, ends: false });
    expect(w.control('Strength').value).toBe('75');
    expect(w.dialog.querySelector('.recording-value')!.textContent).toBe('75 %');
    expect(w.control('Triplets').disabled).toBe(false);
    w.control('Grid').value = '1/8';
    w.change(w.control('Grid'));
    expect(w.settings.setQuantize).toHaveBeenLastCalledWith({ grid: '1/8', triplet: false, strength: 0.75, ends: false });
    w.control('Triplets').checked = true;
    w.change(w.control('Triplets'));
    w.control('Note ends too').checked = true;
    w.change(w.control('Note ends too'));
    // dragging the strength shows it, releasing applies it
    w.control('Strength').value = '40';
    w.control('Strength').dispatchEvent(new Event('input'));
    expect(w.dialog.querySelector('.recording-value')!.textContent).toBe('40 %');
    expect(w.settings.setQuantize).toHaveBeenCalledTimes(3);
    w.change(w.control('Strength'));
    expect(w.settings.setQuantize).toHaveBeenLastCalledWith({ grid: '1/8', triplet: true, strength: 0.4, ends: true });
    w.control('Grid').value = 'off';
    w.change(w.control('Grid'));
    expect(w.control('Triplets').disabled).toBe(true);
  });

  it('the movements: the box says and changes whether they are recorded', () => {
    const w = open();
    const box = w.control('Record them');
    expect(box.checked).toBe(false);
    box.checked = true;
    w.change(box);
    expect(w.settings.moves).toBe(true);
    expect(w.dialog.textContent).toContain("becomes the clip's curve");
  });

  it('the latency: the device\'s ms, the correction applied as the settings keep it, the total', () => {
    const w = open();
    const text = () => w.dialog.textContent!;
    expect(text()).toContain('Audio device: 23 ms');
    expect(text()).toContain('Total: 33 ms');
    const extra = w.control('Extra (ms)');
    expect(extra.value).toBe('10');
    // the settings round and limit it: the field shows what they kept
    Object.defineProperty(w.settings, 'offsetMs', { get: () => 200, set: () => undefined });
    extra.value = '999';
    w.change(extra);
    expect(extra.value).toBe('200');
    expect(text()).toContain('Total: 223 ms');
  });
});
