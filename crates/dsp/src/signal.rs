//! Funzioni di base sul segnale, identiche a `src/dsp/signal.ts`.

use std::f64::consts::PI;

/// Arrotondamento come `Math.round` di JavaScript (le metà vanno verso +∞), così i
/// risultati coincidono con la versione TypeScript.
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Fase riportata in [-π, π].
#[inline]
pub fn princarg(p: f64) -> f64 {
    p - 2.0 * PI * js_round(p / (2.0 * PI))
}

/// Finestra di Hann periodica.
pub fn hann(n: usize) -> Vec<f64> {
    (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect()
}

pub fn mix_mono(channels: &[&[f32]]) -> Vec<f32> {
    let n = channels[0].len();
    if channels.len() == 1 {
        return channels[0].to_vec();
    }
    let g = 1.0 / channels.len() as f32;
    let mut m = vec![0.0f32; n];
    for c in channels {
        for (acc, v) in m.iter_mut().zip(c.iter()) {
            *acc += v * g;
        }
    }
    m
}

/// Copia in `dst` il frame che parte da `start`, moltiplicato per la finestra (zeri fuori).
pub fn read_frame(x: &[f32], start: i64, win: &[f64], dst: &mut [f64]) {
    let n = win.len();
    let len = x.len() as i64;
    if start >= 0 && start + n as i64 <= len {
        let s = start as usize;
        for ((d, &v), &w) in dst[..n].iter_mut().zip(&x[s..s + n]).zip(win) {
            *d = v as f64 * w;
        }
    } else {
        for i in 0..n {
            let j = start + i as i64;
            dst[i] = if j >= 0 && j < len { x[j as usize] as f64 * win[i] } else { 0.0 };
        }
    }
}

/// Overlap-add normalizzato: divide per la somma delle finestre.
pub fn normalize_overlap(out: &mut [f32], wsum: &[f32]) {
    for (y, &w) in out.iter_mut().zip(wsum) {
        if w > 1e-3 {
            *y /= w;
        }
    }
}
