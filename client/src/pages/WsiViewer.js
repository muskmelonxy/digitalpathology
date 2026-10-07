import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from 'react-query';
import axios from 'axios';
import OpenSeadragon from 'openseadragon';
import { useAuth } from '../contexts/AuthContext';
import ViewerChrome from '../components/ViewerChrome';
import ClinicalPanel from '../components/ClinicalPanel';
import {
  MAG_STOPS,
  chooseScaleBar,
  displayedMagnification,
  formatMagnification,
  formatMpp,
  formatName,
  imageZoomForMagnification,
  micronsPerCssPixel,
  nearestStop,
  objectiveOf,
} from '../viewer/measure';
import { macroUrl, thumbnailUrl, tileUrl } from '../viewer/urls';

function destroyViewer(viewer) {
  if (!viewer) return;
  try {
    viewer.destroy();
  } catch (err) {
    // OpenSeadragon can throw if it is torn down mid-open.
  }
}

export default function WsiViewer({
  root,
  filename,
  backTo = '/library',
  title,
  subtitle,
}) {
  const { token } = useAuth();
  const viewerRef = useRef(null);
  const osdRef = useRef(null);
  const [showInfo, setShowInfo] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1100
  );
  const [opened, setOpened] = useState(false);
  const [openError, setOpenError] = useState('');
  const [imageZoom, setImageZoom] = useState(null);
  const [showMacro, setShowMacro] = useState(false);

  const metaQuery = useQuery(
    ['wsi-meta', root, filename],
    () => axios
      .get(`/api/wsi/r/${encodeURIComponent(root)}/${encodeURIComponent(filename)}/meta`)
      .then((res) => res.data),
    { enabled: Boolean(filename), retry: false }
  );

  const libraryQuery = useQuery(
    'wsi-library',
    () => axios.get('/api/wsi/slides?root=library').then((res) => res.data),
    { enabled: root === 'library', retry: false }
  );

  const courseQuery = useQuery(
    'slides',
    () => axios.get('/api/slides').then((res) => res.data),
    { enabled: root === 'uploads' }
  );

  const meta = metaQuery.data;
  const metaError = metaQuery.error
    ? (metaQuery.error.response?.data?.error || metaQuery.error.message)
    : (meta?.error || '');

  useEffect(() => {
    if (!meta || meta.error || !token || !viewerRef.current) return undefined;
    let destroyed = false;
    let viewer = null;
    setOpened(false);
    setOpenError('');
    setImageZoom(null);

    const publishZoom = (instance) => {
      const zoom = instance.viewport.viewportToImageZoom(instance.viewport.getZoom(true));
      setImageZoom(zoom);
    };

    (async () => {
      try {
        const response = await axios.get(
          `/api/wsi/r/${encodeURIComponent(root)}/${encodeURIComponent(filename)}.dzi`,
          { responseType: 'text' }
        );
        if (destroyed || !viewerRef.current) return;
        const xml = new DOMParser().parseFromString(response.data, 'text/xml');
        const image = xml.getElementsByTagName('Image')[0];
        const size = xml.getElementsByTagName('Size')[0];
        if (!image || !size) {
          throw new Error('切片描述文件无效 / Invalid slide descriptor');
        }
        const tileSource = {
          width: Number(size.getAttribute('Width')),
          height: Number(size.getAttribute('Height')),
          tileSize: Number(image.getAttribute('TileSize')),
          tileOverlap: Number(image.getAttribute('Overlap')),
          minLevel: 0,
          getTileUrl(level, x, y) {
            return tileUrl(root, filename, level, x, y, token);
          },
        };

        viewer = OpenSeadragon({
          element: viewerRef.current,
          prefixUrl: `${process.env.PUBLIC_URL}/osd/`,
          showNavigationControl: false,
          showNavigator: true,
          navigatorPosition: 'BOTTOM_RIGHT',
          navigatorSizeRatio: 0.2,
          navigatorMaintainSizeRatio: false,
          navigatorHeight: 132,
          navigatorWidth: 176,
          navigatorAutoFade: false,
          navigatorBackground: 'rgba(16, 22, 20, 0.92)',
          navigatorBorderColor: 'rgba(231, 161, 90, 0.85)',
          navigatorDisplayRegionColor: '#e7a15a',
          maxZoomPixelRatio: 4,
          minZoomImageRatio: 0.7,
          visibilityRatio: 0.7,
          constrainDuringPan: true,
          animationTime: 0.35,
          springStiffness: 8,
          gestureSettingsMouse: {
            clickToZoom: false,
            dblClickToZoom: true,
            scrollToZoom: true,
            pinchToZoom: true,
          },
          gestureSettingsTouch: {
            pinchToZoom: true,
            scrollToZoom: false,
          },
        });
        if (destroyed) {
          destroyViewer(viewer);
          return;
        }
        osdRef.current = viewer;
        const observer = new ResizeObserver(() => viewer.forceResize());
        observer.observe(viewerRef.current);
        viewer.__resizeObserver = observer;
        viewer.addHandler('open', () => {
          setOpened(true);
          viewer.forceResize();
          publishZoom(viewer);
        });
        viewer.addHandler('zoom', () => publishZoom(viewer));
        viewer.addHandler('animation', () => publishZoom(viewer));
        viewer.addHandler('open-failed', () => {
          setOpenError('瓦片源无法打开 / The tile source failed to open');
        });
        viewer.open(tileSource);
      } catch (err) {
        if (!destroyed) {
          setOpenError(err.response?.data?.error || err.message || 'Open failed');
        }
      }
    })();

    return () => {
      destroyed = true;
      viewer?.__resizeObserver?.disconnect();
      destroyViewer(viewer);
      osdRef.current = null;
    };
  }, [meta, root, filename, token]);

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === '+' || event.key === '=') osdRef.current?.viewport.zoomBy(1.35);
      if (event.key === '-' || event.key === '_') osdRef.current?.viewport.zoomBy(1 / 1.35);
      if (event.key === '0') osdRef.current?.viewport.goHome(false);
      if (event.key === 'i') setShowInfo((value) => !value);
      const index = Number(event.key) - 1;
      if (index >= 0 && index < MAG_STOPS.length) {
        goToMagnification(MAG_STOPS[index]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const objective = objectiveOf(meta);
  const magnification = displayedMagnification(objective, imageZoom);
  const scaleBar = chooseScaleBar(micronsPerCssPixel(meta?.mpp_x || meta?.mpp_y, imageZoom));

  const goToMagnification = (mag) => {
    const viewer = osdRef.current;
    const power = objectiveOf(meta);
    if (!viewer || !power) return;
    const target = imageZoomForMagnification(power, mag);
    viewer.viewport.zoomTo(viewer.viewport.imageToViewportZoom(target), null, false);
  };

  const filmstrip = root === 'library'
    ? (libraryQuery.data || []).filter((slide) => !slide.error).map((slide) => ({
      key: slide.id,
      name: slide.name,
      src: thumbnailUrl(slide.root, slide.filename, token),
      active: slide.filename === filename && slide.root === root,
      href: `/library/${encodeURIComponent(slide.filename)}`,
    }))
    : (courseQuery.data || []).filter((slide) => slide.status === 'ready').map((slide) => ({
      key: slide.id,
      name: slide.name,
      src: slide.thumbnail_path,
      active: slide.filename === filename,
      href: `/slides/${slide.id}`,
    }));

  const displayTitle = title || meta?.name || filename;
  const displaySubtitle = subtitle || (meta ? `${formatName(meta.format)} · 直接浏览` : '直接浏览 Direct view');

  const info = meta && !meta.error ? (
    <div className="meta-body">
      <dl>
        <div>
          <dt>尺寸 Dimensions</dt>
          <dd>{meta.width?.toLocaleString()} × {meta.height?.toLocaleString()} px</dd>
        </div>
        <div>
          <dt>扫描倍率 Objective</dt>
          <dd>{objective ? formatMagnification(objective) : '—'}</dd>
        </div>
        <div>
          <dt>分辨率 MPP</dt>
          <dd>{formatMpp(meta.mpp_x)}</dd>
        </div>
        <div>
          <dt>金字塔 Levels</dt>
          <dd>
            {meta.level_count || '—'}
            {meta.dzi_levels ? ` · 瓦片 ${meta.dzi_levels}` : ''}
          </dd>
        </div>
        <div>
          <dt>格式 Format</dt>
          <dd>{formatName(meta.format)}{meta.vendor ? ` · ${meta.vendor}` : ''}</dd>
        </div>
        <div>
          <dt>文件 File</dt>
          <dd className="break-all">{meta.filename}</dd>
        </div>
      </dl>
      {meta.levels?.length > 1 && (
        <ol className="level-list">
          {meta.levels.map((level) => (
            <li key={level.level}>
              <span>L{level.level}</span>
              {level.width.toLocaleString()} × {level.height.toLocaleString()}
              <em>{level.downsample >= 10 ? `${Math.round(level.downsample)}×` : `${level.downsample.toFixed(1)}×`}</em>
            </li>
          ))}
        </ol>
      )}
      {meta.has_macro && (
        <div className="macro-block">
          <label>
            <input
              type="checkbox"
              checked={showMacro}
              onChange={(event) => setShowMacro(event.target.checked)}
            />
            显示宏观图 Show macro
          </label>
          {showMacro && (
            <img src={macroUrl(root, filename, token)} alt="宏观图 Macro" />
          )}
        </div>
      )}
      <p className="meta-note">
        标签图默认不显示，以免带出患者信息。快捷键 1–5 对应 1× 到 40×。
      </p>
    </div>
  ) : (
    <p className="meta-note">{metaError || '正在读取切片信息…'}</p>
  );

  const details = (
    <>
      {info}
      {filename && !metaError ? <ClinicalPanel root={root} filename={filename} /> : null}
    </>
  );

  return (
    <ViewerChrome
      title={displayTitle}
      subtitle={displaySubtitle}
      backTo={backTo}
      backLabel={backTo === '/library' ? '数字切片库' : '返回'}
      viewerRef={osdRef}
      exportName={displayTitle}
      magnifications={objective ? MAG_STOPS : null}
      activeMag={nearestStop(magnification)}
      onMagnification={goToMagnification}
      readout={objective ? formatMagnification(magnification) : (imageZoom ? `${imageZoom.toFixed(2)}×` : '—')}
      readoutHint={objective ? '显示倍率' : '像素倍率'}
      onZoomIn={() => osdRef.current?.viewport.zoomBy(1.35)}
      onZoomOut={() => osdRef.current?.viewport.zoomBy(1 / 1.35)}
      onHome={() => osdRef.current?.viewport.goHome(false)}
      showInfo={showInfo}
      onToggleInfo={() => setShowInfo((value) => !value)}
      filmstrip={filmstrip}
      info={details}
      scaleBar={opened ? scaleBar : null}
      loading={!opened && !openError && !metaError}
      error={openError || metaError}
    >
      <div ref={viewerRef} className="osd-root" />
    </ViewerChrome>
  );
}
