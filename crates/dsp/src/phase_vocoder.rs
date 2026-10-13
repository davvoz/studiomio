//! Phase vocoder (modalità Complex), port di `src/dsp/stretch/phase-vocoder.ts`:
//! phase locking di Laroche-Dolson, fase stereo coerente e reset sui transienti.

use std::f64::consts::PI;

use crate::fft::{join_pair, split_pair, Fft};
use crate::signal::{hann, js_round, mix_mono, normalize_overlap, princarg, read_frame};
use crate::time_map::TimeMap;

pub struct PhaseVocoder {
    n: usize,
    hop: usize,
    nb: usize,
    fft: Fft,
    win: Vec<f64>,
    re: Vec<f64>,
    im: Vec<f64>,
    mr: Vec<f64>,
    mi: Vec<f64>,
    pr: Vec<f64>,
    pi: Vec<f64>,
    mag: Vec<f64>,
    ph: Vec<f64>,
    syn: Vec<f64>,
    peaks: Vec<usize>,
    ar: Vec<f64>,
    ai: Vec<f64>,
    br: Vec<f64>,
    bi: Vec<f64>,
    omega_h: Vec<f64>,
    /// Rotazione da applicare a ogni bin: e^{i(syn - ph)}, calcolata una volta per frame.
    rot_re: Vec<f64>,
    rot_im: Vec<f64>,
}

impl PhaseVocoder {
    pub fn new(n: usize) -> Self {
        let hop = n / 4;
        let nb = n / 2 + 1;
        let z = |len: usize| vec![0.0f64; len];
        PhaseVocoder {
            n,
            hop,
            nb,
            fft: Fft::new(n),
            win: hann(n),
            re: z(n),
            im: z(n),
            mr: z(nb),
            mi: z(nb),
            pr: z(nb),
            pi: z(nb),
            mag: z(nb),
            ph: z(nb),
            syn: z(nb),
            peaks: Vec::with_capacity(nb),
            ar: z(nb),
            ai: z(nb),
            br: z(nb),
            bi: z(nb),
            omega_h: (0..nb).map(|k| 2.0 * PI * (k * hop) as f64 / n as f64).collect(),
            rot_re: z(nb),
            rot_im: z(nb),
        }
    }

    /// `channels`: un slice per canale; restituisce i canali elaborati, lunghi `out_len`.
    pub fn run(&mut self, channels: &[&[f32]], map: &TimeMap, out_len: usize, transients: &[f64]) -> Vec<Vec<f32>> {
        let (n, hop) = (self.n, self.hop);
        let h = n / 2;
        let mono = mix_mono(channels);
        let mut outs = vec![vec![0.0f32; out_len]; channels.len()];
        let mut wsum = vec![0.0f32; out_len];
        let mut ti = 0;
        let mut first = true;

        let mut f = 0usize;
        loop {
            let oc = (f * hop) as i64;
            let os = oc - h as i64;
            if os >= out_len as i64 {
                break;
            }
            let ic = map.input_at(oc as f64);
            let a = js_round(ic) as i64 - h as i64;
            let max_mag = self.analyze_mid(&mono, a);

            let mut reset = first;
            while ti < transients.len() && transients[ti] <= ic {
                if !first {
                    reset = true;
                }
                ti += 1;
            }
            if reset {
                self.syn.copy_from_slice(&self.ph);
            } else {
                self.advance_phase(max_mag);
            }
            for k in 0..self.nb {
                let (s, c) = (self.syn[k] - self.ph[k]).sin_cos();
                self.rot_re[k] = c;
                self.rot_im[k] = s;
            }

            let mut c = 0;
            while c < channels.len() {
                self.synthesize_pair(channels, c, a, &mut outs, os, out_len);
                c += 2;
            }
            let (i0, i1) = Self::overlap(os, n, out_len);
            for i in i0..i1 {
                let w = self.win[i];
                wsum[(os + i as i64) as usize] += (w * w) as f32;
            }
            first = false;
            f += 1;
        }
        for y in outs.iter_mut() {
            normalize_overlap(y, &wsum);
        }
        outs
    }

    /// Indici del frame che cadono dentro l'uscita.
    fn overlap(os: i64, n: usize, out_len: usize) -> (usize, usize) {
        let i0 = (-os).max(0) as usize;
        let i1 = (out_len as i64 - os).min(n as i64).max(0) as usize;
        (i0, i1)
    }

    fn analyze_mid(&mut self, mono: &[f32], a: i64) -> f64 {
        read_frame(mono, a, &self.win, &mut self.re);
        read_frame(mono, a - self.hop as i64, &self.win, &mut self.im);
        self.fft.forward(&mut self.re, &mut self.im);
        split_pair(&self.re, &self.im, &mut self.mr, &mut self.mi, &mut self.pr, &mut self.pi);
        let mut max_mag = 0.0f64;
        for k in 0..self.nb {
            let m = (self.mr[k] * self.mr[k] + self.mi[k] * self.mi[k]).sqrt();
            self.mag[k] = m;
            self.ph[k] = self.mi[k].atan2(self.mr[k]);
            if m > max_mag {
                max_mag = m;
            }
        }
        max_mag
    }

    fn advance_phase(&mut self, max_mag: f64) {
        let nb = self.nb;
        let (mag, ph, syn, om, pr, pi) = (&self.mag, &self.ph, &mut self.syn, &self.omega_h, &self.pr, &self.pi);
        let dev = |k: usize| princarg(ph[k] - pi[k].atan2(pr[k]) - om[k]);
        let thr = max_mag * 1e-6;
        let peaks = &mut self.peaks;
        peaks.clear();
        for k in 2..nb - 2 {
            let m = mag[k];
            if m > thr && m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2] {
                peaks.push(k);
            }
        }
        if peaks.is_empty() {
            for k in 0..nb {
                syn[k] += om[k] + dev(k);
            }
            return;
        }
        for &p in peaks.iter() {
            syn[p] = princarg(syn[p] + om[p] + dev(p));
        }
        let mut start = 0;
        for (j, &p) in peaks.iter().enumerate() {
            let mut end = nb;
            if let Some(&q) = peaks.get(j + 1) {
                end = p + 1;
                for k in p + 1..q {
                    if mag[k] < mag[end] {
                        end = k;
                    }
                }
            }
            for k in start..end {
                if k != p {
                    syn[k] = syn[p] + ph[k] - ph[p];
                }
            }
            start = end;
        }
    }

    fn synthesize_pair(&mut self, channels: &[&[f32]], c: usize, a: i64, outs: &mut [Vec<f32>], os: i64, out_len: usize) {
        let n_ch = channels.len();
        let two = c + 1 < n_ch;
        read_frame(channels[c], a, &self.win, &mut self.re);
        if two {
            read_frame(channels[c + 1], a, &self.win, &mut self.im);
        } else {
            self.im.fill(0.0);
        }
        self.fft.forward(&mut self.re, &mut self.im);
        split_pair(&self.re, &self.im, &mut self.ar, &mut self.ai, &mut self.br, &mut self.bi);
        // Modulo del canale con fase syn + (fase del canale - fase del mid): equivale a
        // ruotare il bin del canale di e^{i(syn - ph)}, senza atan2/hypot/sin/cos per canale.
        // In mono il canale è il mid, quindi la fase risulta esattamente syn.
        let (rr, ri) = (&self.rot_re, &self.rot_im);
        let resynth = |xr: &mut [f64], xi: &mut [f64]| {
            for k in 0..xr.len() {
                let (a, b) = (xr[k], xi[k]);
                xr[k] = a * rr[k] - b * ri[k];
                xi[k] = a * ri[k] + b * rr[k];
            }
        };
        resynth(&mut self.ar, &mut self.ai);
        if two {
            resynth(&mut self.br, &mut self.bi);
        }
        let y = if two { Some((&self.br[..], &self.bi[..])) } else { None };
        join_pair(&self.ar, &self.ai, y, &mut self.re, &mut self.im);
        self.fft.inverse(&mut self.re, &mut self.im);
        let (i0, i1) = Self::overlap(os, self.n, out_len);
        let base = os + i0 as i64;
        let (first, rest) = outs.split_at_mut(c + 1);
        let y0 = &mut first[c];
        for (k, i) in (i0..i1).enumerate() {
            y0[base as usize + k] += (self.re[i] * self.win[i]) as f32;
        }
        if two {
            let y1 = &mut rest[0];
            for (k, i) in (i0..i1).enumerate() {
                y1[base as usize + k] += (self.im[i] * self.win[i]) as f32;
            }
        }
    }
}
