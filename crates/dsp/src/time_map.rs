//! Piecewise linear warp map, identical to `src/dsp/time-map.ts`.

pub struct TimeMap {
    out: Vec<f64>,
    inp: Vec<f64>,
}

impl TimeMap {
    pub fn new(out: &[f64], inp: &[f64]) -> Self {
        assert!(!out.is_empty() && out.len() == inp.len(), "TimeMap: invalid points");
        TimeMap { out: out.to_vec(), inp: inp.to_vec() }
    }

    /// Input sample that plays at output sample `o`.
    pub fn input_at(&self, o: f64) -> f64 {
        Self::lerp(&self.out, &self.inp, o)
    }

    fn lerp(a: &[f64], b: &[f64], v: f64) -> f64 {
        if a.len() == 1 {
            return b[0] + (v - a[0]);
        }
        let k = Self::segment(a, v);
        let d = a[k + 1] - a[k];
        if d > 0.0 { b[k] + (v - a[k]) * (b[k + 1] - b[k]) / d } else { b[k] }
    }

    fn segment(arr: &[f64], v: f64) -> usize {
        let n = arr.len();
        if v <= arr[0] {
            return 0;
        }
        if v >= arr[n - 1] {
            return n - 2;
        }
        // last index with arr[i] <= v, limited to n-2
        arr[..n - 1].partition_point(|&x| x <= v) - 1
    }
}
