//! studiomio's DSP engine compiled to WebAssembly. The exported functions receive the
//! channels one after the other in a single array ("planar") and return the same format.

mod fft;
mod phase_vocoder;
mod signal;
mod time_map;

use wasm_bindgen::prelude::*;

use phase_vocoder::PhaseVocoder;
use time_map::TimeMap;

/// Complex mode. `map_out`/`map_in`: warp map points in samples;
/// `fft_size`: size already chosen for the sample rate; `transients`: input samples.
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
