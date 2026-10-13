//! FFT complessa radix-2 in place, identica a `src/dsp/fft.ts`.

use std::f64::consts::PI;

pub struct Fft {
    n: usize,
    rev: Vec<u32>,
    cos: Vec<f64>,
    sin: Vec<f64>,
}

impl Fft {
    pub fn new(n: usize) -> Self {
        assert!(n >= 2 && n.is_power_of_two(), "FFT: {n} non è una potenza di 2");
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| i.reverse_bits() >> (32 - bits)).collect();
        let half = n / 2;
        let cos = (0..half).map(|i| (2.0 * PI * i as f64 / n as f64).cos()).collect();
        let sin = (0..half).map(|i| (2.0 * PI * i as f64 / n as f64).sin()).collect();
        Fft { n, rev, cos, sin }
    }

    pub fn forward(&self, re: &mut [f64], im: &mut [f64]) {
        self.transform(re, im, -1.0);
    }

    /// Inversa, già normalizzata per 1/n.
    pub fn inverse(&self, re: &mut [f64], im: &mut [f64]) {
        self.transform(re, im, 1.0);
        let s = 1.0 / self.n as f64;
        re.iter_mut().for_each(|v| *v *= s);
        im.iter_mut().for_each(|v| *v *= s);
    }

    fn transform(&self, re: &mut [f64], im: &mut [f64], sgn: f64) {
        let n = self.n;
        let (re, im) = (&mut re[..n], &mut im[..n]);
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= n {
            let half = size / 2;
            let step = n / size;
            for j in 0..half {
                let k = j * step;
                let (wr, wi) = (self.cos[k], sgn * self.sin[k]);
                let mut a = j;
                while a < n {
                    let b = a + half;
                    let tr = re[b] * wr - im[b] * wi;
                    let ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                    a += size;
                }
            }
            size <<= 1;
        }
    }
}

/// Dopo la FFT di (x + i·y), con x e y reali, separa gli spettri di x e y (bin 0..n/2).
pub fn split_pair(re: &[f64], im: &[f64], xr: &mut [f64], xi: &mut [f64], yr: &mut [f64], yi: &mut [f64]) {
    let n = re.len();
    for k in 0..=n / 2 {
        let nk = (n - k) & (n - 1);
        xr[k] = 0.5 * (re[k] + re[nk]);
        xi[k] = 0.5 * (im[k] - im[nk]);
        yr[k] = 0.5 * (im[k] + im[nk]);
        yi[k] = -0.5 * (re[k] - re[nk]);
    }
}

/// Inverso di `split_pair`: con `y` assente il secondo segnale è silenzio.
pub fn join_pair(xr: &[f64], xi: &[f64], y: Option<(&[f64], &[f64])>, re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let h = n / 2;
    for k in 0..=h {
        let (yr, yi) = y.map_or((0.0, 0.0), |(yr, yi)| (yr[k], yi[k]));
        if k == 0 || k == h {
            re[k] = xr[k];
            im[k] = yr;
        } else {
            re[k] = xr[k] - yi;
            im[k] = xi[k] + yr;
            re[n - k] = xr[k] + yi;
            im[n - k] = -xi[k] + yr;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_then_inverse_is_identity() {
        let fft = Fft::new(64);
        let orig: Vec<f64> = (0..64).map(|i| ((i * 7) % 13) as f64 - 6.0).collect();
        let (mut re, mut im) = (orig.clone(), vec![0.0; 64]);
        fft.forward(&mut re, &mut im);
        fft.inverse(&mut re, &mut im);
        for (a, b) in re.iter().zip(&orig) {
            assert!((a - b).abs() < 1e-9);
        }
    }
}
