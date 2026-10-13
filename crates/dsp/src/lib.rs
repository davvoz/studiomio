//! Motore DSP di studiomio compilato in WebAssembly. Le funzioni esportate ricevono i
//! canali uno dopo l'altro in un unico array ("planari") e restituiscono lo stesso formato.

mod fft;
mod phase_vocoder;
mod signal;
mod time_map;

use wasm_bindgen::prelude::*;

use phase_vocoder::PhaseVocoder;
use time_map::TimeMap;

/// Modalità Complex. `map_out`/`map_in`: punti della mappa di warp in campioni;
/// `fft_size`: dimensione già scelta per il sample rate; `transients`: campioni di ingresso.
#[wasm_bindgen]
pub fn pv_stretch(
    planar: &[f32],
    channels: usize,
    map_out: &[f64],
    map_in: &[f64],
    out_len: usize,
    fft_size: usize,
    transients: &[f64],
) -> Vec<f32> {
    let len = planar.len() / channels;
    let chans: Vec<&[f32]> = planar.chunks_exact(len).collect();
    let map = TimeMap::new(map_out, map_in);
    let outs = PhaseVocoder::new(fft_size).run(&chans, &map, out_len, transients);
    outs.concat()
}
