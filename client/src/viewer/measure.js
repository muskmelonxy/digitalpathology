/** Magnification and scale-bar math for the slide viewer. */

export const MAG_STOPS = [1, 5, 10, 20, 40];

export function objectiveOf(meta) {
  if (!meta) return null;
  if (meta.objective_power) return Number(meta.objective_power);
  if (meta.mpp_x) return 10 / Number(meta.mpp_x);
  return null;
}

/**
 * OpenSeadragon image zoom is screen CSS pixels per image pixel
 * (1 = the scan shown at its native pixel size).
 */
export function displayedMagnification(objective, imageZoom) {
  if (!objective || !imageZoom) return null;
  return objective * imageZoom;
}

export function imageZoomForMagnification(objective, magnification) {
  if (!objective || !magnification) return null;
  return magnification / objective;
}

export function micronsPerCssPixel(mpp, imageZoom) {
  if (!mpp || !imageZoom) return null;
  return mpp / imageZoom;
}

export function nearestStop(magnification, stops = MAG_STOPS) {
  if (!magnification || magnification <= 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const stop of stops) {
    const distance = Math.abs(Math.log(magnification / stop));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stop;
    }
  }
  return bestDistance < 0.18 ? best : null;
}

export function formatMagnification(value) {
  if (!value || !Number.isFinite(value)) return '—';
  if (value >= 10) return `${Math.round(value)}×`;
  if (value >= 1) return `${value.toFixed(1)}×`;
  return `${value.toFixed(2)}×`;
}

export function formatMpp(mpp) {
  if (!mpp || !Number.isFinite(Number(mpp))) return '—';
  const value = Number(mpp);
  const digits = value >= 1 ? 2 : 4;
  return `${value.toFixed(digits)} µm/px`;
}

/** Pick a 1/2/5 scale bar near `targetPx` CSS pixels wide. */
export function chooseScaleBar(micronsPerCssPx, targetPx = 120) {
  if (!micronsPerCssPx || micronsPerCssPx <= 0 || !Number.isFinite(micronsPerCssPx)) {
    return null;
  }
  const raw = micronsPerCssPx * targetPx;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const nice = frac >= 5 ? 5 : frac >= 2 ? 2 : 1;
  const microns = nice * pow;
  const px = microns / micronsPerCssPx;
  let label;
  if (microns >= 1000) {
    const mm = microns / 1000;
    label = Number.isInteger(mm) ? `${mm} mm` : `${mm.toFixed(mm >= 10 ? 0 : 1)} mm`;
  } else if (microns >= 10) {
    label = `${Math.round(microns)} µm`;
  } else if (microns >= 1) {
    label = `${microns} µm`;
  } else {
    label = `${microns.toFixed(1)} µm`;
  }
  return { px, label, microns };
}

export function formatName(format) {
  const key = String(format || '').toLowerCase();
  const labels = {
    kfbio: 'KFB',
    kfb: 'KFB',
    aperio: 'SVS',
    hamamatsu: 'NDPI',
    leica: 'SCN',
    'generic-tiff': 'TIFF',
    tiff: 'TIFF',
    tif: 'TIFF',
    svs: 'SVS',
    ndpi: 'NDPI',
    scn: 'SCN',
    bif: 'BIF',
    vms: 'VMS',
    mrxs: 'MRXS',
  };
  return labels[key] || (key ? key.toUpperCase() : 'WSI');
}
