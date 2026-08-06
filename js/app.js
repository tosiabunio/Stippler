'use strict';

(() => {
  const $ = id => document.getElementById(id);

  const els = {
    fileInput: $('file-input'),
    btnOpen: $('btn-open'),
    fileName: $('file-name'),
    algorithm: $('algorithm'),
    threshold: $('threshold'),
    brightness: $('brightness'),
    contrast: $('contrast'),
    gamma: $('gamma'),
    strength: $('strength'),
    pixelScale: $('pixel-scale'),
    alphaThreshold: $('alpha-threshold'),
    invert: $('invert'),
    serpentine: $('serpentine'),
    btnReset: $('btn-reset'),
    btnExport: $('btn-export'),
    btnOriginal: $('btn-original'),
    btnFit: $('btn-fit'),
    previewArea: $('preview-area'),
    dropHint: $('drop-hint'),
    canvasWrap: $('canvas-wrap'),
    canvasOutput: $('canvas-output'),
    canvasOriginal: $('canvas-original'),
  };

  const DEFAULTS = {
    threshold: 128, brightness: 0, contrast: 0, gamma: 1,
    strength: 100, pixelScale: 1, alphaThreshold: 128,
    invert: false, serpentine: false,
  };

  const state = {
    img: null,       // ImageBitmap oryginału
    baseName: 'image',
    zoom: 1,
  };

  // Robocze canvasy poza DOM
  const workCanvas = document.createElement('canvas');   // pomniejszony obraz źródłowy
  const smallCanvas = document.createElement('canvas');  // wynik ditheringu (pomniejszony)

  function params() {
    return {
      algorithm: els.algorithm.value,
      threshold: +els.threshold.value,
      brightness: +els.brightness.value,
      contrast: +els.contrast.value,
      gamma: +els.gamma.value,
      strength: +els.strength.value / 100,
      alphaThreshold: +els.alphaThreshold.value,
      invert: els.invert.checked,
      serpentine: els.serpentine.checked,
    };
  }

  // --- Rendering ---

  function render() {
    if (!state.img) return;
    const { img } = state;
    const scale = +els.pixelScale.value;
    const sw = Math.max(1, Math.round(img.width / scale));
    const sh = Math.max(1, Math.round(img.height / scale));

    workCanvas.width = sw;
    workCanvas.height = sh;
    const wctx = workCanvas.getContext('2d', { willReadFrequently: true });
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = 'high';
    wctx.clearRect(0, 0, sw, sh);
    wctx.drawImage(img, 0, 0, sw, sh);

    const result = DITHER.process(wctx.getImageData(0, 0, sw, sh), params());

    smallCanvas.width = sw;
    smallCanvas.height = sh;
    smallCanvas.getContext('2d').putImageData(result, 0, 0);

    // Wynik w oryginalnej rozdzielczości (nearest-neighbor przy skali > 1)
    els.canvasOutput.width = img.width;
    els.canvasOutput.height = img.height;
    const octx = els.canvasOutput.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, img.width, img.height);
    octx.drawImage(smallCanvas, 0, 0, img.width, img.height);
  }

  let renderTimer = 0;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 30);
  }

  // --- Wczytywanie pliku ---

  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const img = await createImageBitmap(file);
      state.img = img;
      state.baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
      els.fileName.textContent = `${file.name} (${img.width}×${img.height})`;
      els.btnExport.disabled = false;
      els.dropHint.style.display = 'none';
      els.canvasWrap.hidden = false;

      els.canvasOriginal.width = img.width;
      els.canvasOriginal.height = img.height;
      els.canvasOriginal.getContext('2d').drawImage(img, 0, 0);

      render();
      fitZoom();
    } catch (e) {
      els.fileName.textContent = 'Failed to load the file.';
      console.error(e);
    }
  }

  // --- Zoom ---

  function applyZoom() {
    if (!state.img) return;
    const w = Math.max(1, Math.round(state.img.width * state.zoom));
    const h = Math.max(1, Math.round(state.img.height * state.zoom));
    els.canvasWrap.style.width = w + 'px';
    els.canvasWrap.style.height = h + 'px';
    els.canvasOutput.style.width = w + 'px';
    els.canvasOutput.style.height = h + 'px';
  }

  function fitZoom() {
    if (!state.img) return;
    const pad = 40;
    const aw = els.previewArea.clientWidth - pad;
    const ah = els.previewArea.clientHeight - pad;
    state.zoom = Math.min(aw / state.img.width, ah / state.img.height, 8);
    if (state.zoom <= 0) state.zoom = 1;
    applyZoom();
  }

  // --- Eksport ---

  function exportPng() {
    els.canvasOutput.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${state.baseName}-dithered.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  // --- Widoczność parametrów zależnych od algorytmu ---

  function updateParamVisibility() {
    const algo = els.algorithm.value;
    const isDiffusion = !!DITHER.KERNELS[algo];
    $('row-serpentine').style.display = isDiffusion ? '' : 'none';
    const strengthVisible = algo !== 'threshold';
    $('row-strength').style.display = strengthVisible ? '' : 'none';
    els.strength.style.display = strengthVisible ? '' : 'none';
  }

  // --- Podpisy wartości suwaków ---

  function updateOutputs() {
    document.querySelectorAll('output[for]').forEach(out => {
      const input = $(out.getAttribute('for'));
      if (!input) return;
      let v = input.value;
      if (input === els.gamma) v = (+v).toFixed(2);
      if (input === els.strength) v = v + '%';
      out.textContent = v;
    });
  }

  // --- Zdarzenia ---

  els.btnOpen.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => loadFile(els.fileInput.files[0]));

  ['dragenter', 'dragover'].forEach(ev =>
    document.body.addEventListener(ev, e => {
      e.preventDefault();
      els.previewArea.classList.add('dragover');
    }));
  ['dragleave', 'drop'].forEach(ev =>
    document.body.addEventListener(ev, e => {
      e.preventDefault();
      els.previewArea.classList.remove('dragover');
    }));
  document.body.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

  document.querySelectorAll('#sidebar input, #sidebar select').forEach(el => {
    el.addEventListener('input', () => {
      updateOutputs();
      updateParamVisibility();
      scheduleRender();
    });
  });

  els.btnReset.addEventListener('click', () => {
    els.threshold.value = DEFAULTS.threshold;
    els.brightness.value = DEFAULTS.brightness;
    els.contrast.value = DEFAULTS.contrast;
    els.gamma.value = DEFAULTS.gamma;
    els.strength.value = DEFAULTS.strength;
    els.pixelScale.value = DEFAULTS.pixelScale;
    els.alphaThreshold.value = DEFAULTS.alphaThreshold;
    els.invert.checked = DEFAULTS.invert;
    els.serpentine.checked = DEFAULTS.serpentine;
    updateOutputs();
    scheduleRender();
  });

  els.btnExport.addEventListener('click', exportPng);
  els.btnFit.addEventListener('click', fitZoom);

  // Podgląd oryginału: przytrzymanie przycisku lub spacji
  function showOriginal(show) {
    els.canvasOriginal.hidden = !show || !state.img;
  }
  els.btnOriginal.addEventListener('pointerdown', () => showOriginal(true));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    els.btnOriginal.addEventListener(ev, () => showOriginal(false)));
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      showOriginal(true);
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') showOriginal(false);
  });

  // Zoom kółkiem myszy
  els.previewArea.addEventListener('wheel', e => {
    if (!state.img) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    state.zoom = Math.min(32, Math.max(0.05, state.zoom * factor));
    applyZoom();
  }, { passive: false });

  updateOutputs();
  updateParamVisibility();
})();
