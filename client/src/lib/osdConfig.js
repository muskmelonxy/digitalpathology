import OpenSeadragon from 'openseadragon';

export const OSD_PREFIX =
  'https://cdn.jsdelivr.net/npm/openseadragon@4.1.0/build/openseadragon/images/';

/**
 * Custom tile source matching the on-disk pyramid:
 *   server level 0 = lowest res, maxLevel = full res
 *   OSD level 0 = full res (inverted via getTileUrl / getLevelScale)
 */
export function buildTileSource({ id, width, height, tileSize, maxLevel, tilesVersion = 1 }) {
  return {
    width,
    height,
    tileSize,
    minLevel: 0,
    maxLevel,
    getLevelScale: function (level) {
      return 1 / Math.pow(2, level);
    },
    getNumTiles: function (level) {
      const scale = Math.pow(2, level);
      return {
        x: Math.max(1, Math.ceil(width / scale / tileSize)),
        y: Math.max(1, Math.ceil(height / scale / tileSize))
      };
    },
    getTileUrl: function (level, x, y) {
      const serverLevel = maxLevel - level;
      return `/tiles/${id}/${serverLevel}/${x}_${y}.jpg?v=${tilesVersion}`;
    }
  };
}

export function buildOsdOptions(element) {
  return {
    element,
    prefixUrl: OSD_PREFIX,
    showNavigationControl: false,
    maxZoomPixelRatio: 20,
    minZoomLevel: 0.1,
    visibilityRatio: 0.5,
    constrainDuringPan: true,
    animationTime: 0.2,
    springStiffness: 10,
    imageLoaderLimit: 32,
    timeout: 12000,
    tileRetry: 5,
    maxImageCacheCount: 800,
    preload: true,
    blendTime: 0.06,
    immediateRender: true,
    minPixelRatio: 0.5,
    placeholderFillStyle: '#111827',
    gestureSettingsMouse: {
      clickToZoom: true,
      dblClickToZoom: true,
      pinchToZoom: true,
      scrollToZoom: true
    },
    gestureSettingsTouch: {
      pinchToZoom: true,
      scrollToZoom: true
    },
    showNavigator: true,
    navigatorPosition: 'TOP_LEFT',
    navigatorSizeRatio: 0.16,
    navigatorAutoResize: true,
    navigatorAutoFade: false
  };
}

export function parseViewportHash() {
  const h = (typeof window !== 'undefined' && window.location.hash
    ? window.location.hash.slice(1)
    : '');
  const m = h.match(/^([\d.]+),([\d.]+),([\d.]+)/);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  const zoom = Number(m[3]);
  if (![x, y, zoom].every(Number.isFinite)) return null;
  return { x, y, zoom };
}

export function writeViewportHash(viewer) {
  if (!viewer || !viewer.viewport) return;
  const c = viewer.viewport.getCenter();
  const z = viewer.viewport.getZoom(true);
  const hash = `#${c.x.toFixed(5)},${c.y.toFixed(5)},${z.toFixed(4)}`;
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }
}

export function applyViewportHash(viewer) {
  const vp = parseViewportHash();
  if (!vp || !viewer || !viewer.viewport) return false;
  viewer.viewport.panTo(new OpenSeadragon.Point(vp.x, vp.y), true);
  viewer.viewport.zoomTo(vp.zoom, null, true);
  return true;
}

export function bindViewportHash(viewer) {
  let timer = null;
  const onAnim = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => writeViewportHash(viewer), 150);
  };
  viewer.addHandler('animation-finish', onAnim);
  viewer.addHandler('zoom', onAnim);
  return () => {
    if (timer) clearTimeout(timer);
    try { viewer.removeHandler('animation-finish', onAnim); } catch (e) {}
    try { viewer.removeHandler('zoom', onAnim); } catch (e) {}
  };
}

export function placeholderStyle(src) {
  return {
    backgroundColor: '#111',
    backgroundImage: src ? `url(${src})` : 'none',
    backgroundSize: 'contain',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center'
  };
}
