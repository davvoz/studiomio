/* Le impostazioni di un dispositivo (tipo, preset, parametri, sample) come JSON: lo strumento
 * di una traccia, gli effetti, il suono di una clip MIDI. */
import { asId } from '../core/id';
import type { DeviceSettings } from '../model/device';
import type { JsonObject, JsonReader } from './json-reader';

export const encodeInstrument = (i: DeviceSettings): JsonObject => ({
  type: i.type, preset: i.preset, params: { ...i.params },
  ...(i.samples ? { samples: { ...i.samples } } : {}),
});

export const decodeInstrument = (r: JsonReader): DeviceSettings => {
  const params = r.get('params');
  const samples = r.has('samples') ? r.get('samples') : null;
  return {
    type: r.str('type'),
    preset: r.nullable('preset', p => p.asString()),
    params: Object.fromEntries(params.keys().map(k => [k, params.num(k)])),
    ...(samples ? { samples: Object.fromEntries(samples.keys().map(k => [k, asId<'sample'>(samples.str(k))])) } : {}),
  };
};
