'use strict';

/**
 * DITHER — czyste funkcje przetwarzania obrazu.
 * Wejście: ImageData (RGBA), wyjście: ImageData zawierające wyłącznie
 * piksele (0,0,0,255), (255,255,255,255) oraz (0,0,0,0).
 */
const DITHER = (() => {

  // --- Jądra dyfuzji błędu: [dx, dy, waga], dzielnik ---
  const KERNELS = {
    'floyd-steinberg': { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    'jarvis': {
      div: 48, taps: [
        [1, 0, 7], [2, 0, 5],
        [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
        [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]]
    },
    'stucki': {
      div: 42, taps: [
        [1, 0, 8], [2, 0, 4],
        [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
        [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]]
    },
    'atkinson': { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
    'burkes': {
      div: 32, taps: [
        [1, 0, 8], [2, 0, 4],
        [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]]
    },
    'sierra': {
      div: 32, taps: [
        [1, 0, 5], [2, 0, 3],
        [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
        [-1, 2, 2], [0, 2, 3], [1, 2, 2]]
    },
    'sierra-two-row': {
      div: 16, taps: [
        [1, 0, 4], [2, 0, 3],
        [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]]
    },
    'sierra-lite': { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
  };

  // --- Macierz Bayera n×n (n = potęga 2), wartości 0..n²-1 ---
  function bayerMatrix(n) {
    let m = [[0, 2], [3, 1]];
    while (m.length < n) {
      const s = m.length;
      const next = Array.from({ length: s * 2 }, () => new Array(s * 2));
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const v = 4 * m[y][x];
          next[y][x] = v;
          next[y][x + s] = v + 2;
          next[y + s][x] = v + 3;
          next[y + s][x + s] = v + 1;
        }
      }
      m = next;
    }
    return m;
  }

  // --- Raster halftone z funkcji plamki ---
  // Zamiast stałej macierzy 8×8 liczymy próg analitycznie, więc rozmiar komórki
  // i kąt rastra są dowolne, a ekran działa w pełnej rozdzielczości obrazu.

  const COS_N = 4096;
  const COS_LUT = Float32Array.from(
    { length: COS_N }, (_, i) => Math.cos(2 * Math.PI * i / COS_N));

  // Funkcja plamki: maksimum (1) w środku kropki, minimum (-1) w środku prześwitu.
  const spot = (u, v) => 0.5 * (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v));

  const EQ_N = 512;

  /**
   * Buduje ekran rastrowy. Zwraca funkcję (x, y) → próg 0..1,
   * gdzie 0 = środek kropki (czernieje pierwszy), 1 = środek prześwitu.
   */
  function buildHalftoneScreen(size, angleDeg) {
    const cell = Math.max(2, size || 8);
    const rad = (angleDeg || 0) * Math.PI / 180;
    const ca = Math.cos(rad) / cell;
    const sa = Math.sin(rad) / cell;

    // Wyrównanie histogramu funkcji plamki: eq(f) = jaka część komórki ma
    // wartość większą niż f. Bez tego pokrycie czernią nie byłoby liniowe
    // względem jasności i półcienie wychodziłyby za ciemne.
    const S = 96;
    const samples = new Float32Array(S * S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        samples[j * S + i] = spot((i + 0.5) / S, (j + 0.5) / S);
      }
    }
    samples.sort();
    const eq = new Float32Array(EQ_N);
    for (let k = 0; k < EQ_N; k++) {
      const f = -1 + 2 * k / (EQ_N - 1);
      let lo = 0, hi = samples.length;
      while (lo < hi) {                       // pierwszy indeks o wartości > f
        const mid = (lo + hi) >> 1;
        if (samples[mid] <= f) lo = mid + 1; else hi = mid;
      }
      eq[k] = (samples.length - lo) / samples.length;
    }

    return function screenAt(x, y) {
      const u = x * ca + y * sa;
      const v = y * ca - x * sa;
      const iu = ((u - Math.floor(u)) * COS_N) | 0;
      const iv = ((v - Math.floor(v)) * COS_N) | 0;
      const f = 0.5 * (COS_LUT[iu] + COS_LUT[iv]);
      let k = ((f + 1) * 0.5 * (EQ_N - 1) + 0.5) | 0;
      if (k < 0) k = 0; else if (k >= EQ_N) k = EQ_N - 1;
      return eq[k];
    };
  }

  // --- LUT korekt wstępnych: jasność, kontrast, gamma, inwersja ---
  function buildAdjustLut(p) {
    const lut = new Float32Array(256);
    const cf = (259 * (p.contrast + 255)) / (255 * (259 - p.contrast));
    for (let i = 0; i < 256; i++) {
      let v = i + p.brightness;
      v = cf * (v - 128) + 128;
      v = Math.min(255, Math.max(0, v));
      v = 255 * Math.pow(v / 255, 1 / p.gamma);
      if (p.invert) v = 255 - v;
      lut[i] = v;
    }
    return lut;
  }

  // --- Dithering macierzowy (ordered/halftone/losowy/progowy) ---
  function orderedDither(gray, mask, w, h, params, matrix, screenAt) {
    const out = new Uint8Array(w * h);
    const n = matrix ? matrix.length : 0;
    const n2 = n * n;
    const s = params.strength;
    const t = params.threshold;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let v = gray[i];
        if (matrix) {
          v += s * (((matrix[y % n][x % n] + 0.5) / n2) - 0.5) * 255;
        } else if (screenAt) {
          v += s * (screenAt(x, y) - 0.5) * 255;
        } else if (params.algorithm === 'random') {
          v += s * (Math.random() - 0.5) * 255;
        }
        out[i] = v >= t ? 255 : 0;
      }
    }
    return out;
  }

  // --- Generyczna dyfuzja błędu ---
  function errorDiffuse(gray, mask, w, h, params) {
    const out = new Uint8Array(w * h);
    const { div, taps } = KERNELS[params.algorithm];
    const buf = Float32Array.from(gray);
    const t = params.threshold;
    const s = params.strength;
    for (let y = 0; y < h; y++) {
      const reverse = params.serpentine && (y & 1);
      const x0 = reverse ? w - 1 : 0;
      const x1 = reverse ? -1 : w;
      const step = reverse ? -1 : 1;
      for (let x = x0; x !== x1; x += step) {
        const i = y * w + x;
        if (!mask[i]) continue; // przezroczyste piksele poza dyfuzją
        const v = buf[i];
        const o = v >= t ? 255 : 0;
        out[i] = o;
        const err = (v - o) * s;
        if (err === 0) continue;
        for (const [dx, dy, wgt] of taps) {
          const nx = x + (reverse ? -dx : dx);
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni]) continue; // błąd nie wpływa do przezroczystych
          buf[ni] += err * wgt / div;
        }
      }
    }
    return out;
  }

  const MATRIX_ALGOS = {
    'bayer-2': () => bayerMatrix(2),
    'bayer-4': () => bayerMatrix(4),
    'bayer-8': () => bayerMatrix(8),
  };

  /**
   * Główne wejście. imageData → nowe ImageData (ta sama rozdzielczość).
   * params: { algorithm, threshold, brightness, contrast, gamma, invert,
   *           strength (0..1), serpentine, alphaThreshold,
   *           screenSize (px), screenAngle (stopnie) — tylko dla 'halftone' }
   */
  function process(imageData, params) {
    const { width: w, height: h, data } = imageData;
    const size = w * h;
    const gray = new Float32Array(size);
    const mask = new Uint8Array(size);
    const lut = buildAdjustLut(params);

    for (let i = 0; i < size; i++) {
      const p = i * 4;
      if (data[p + 3] >= params.alphaThreshold) {
        mask[i] = 1;
        const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
        gray[i] = lut[Math.round(lum)];
      }
    }

    let bw;
    if (KERNELS[params.algorithm]) {
      bw = errorDiffuse(gray, mask, w, h, params);
    } else if (params.algorithm === 'halftone') {
      const screenAt = buildHalftoneScreen(params.screenSize, params.screenAngle);
      bw = orderedDither(gray, mask, w, h, params, null, screenAt);
    } else {
      const matrix = MATRIX_ALGOS[params.algorithm] ? MATRIX_ALGOS[params.algorithm]() : null;
      bw = orderedDither(gray, mask, w, h, params, matrix);
    }

    const out = new ImageData(w, h);
    const od = out.data;
    for (let i = 0; i < size; i++) {
      if (!mask[i]) continue; // pozostaje (0,0,0,0)
      const p = i * 4;
      od[p] = od[p + 1] = od[p + 2] = bw[i];
      od[p + 3] = 255;
    }
    return out;
  }

  return { process, KERNELS };
})();
