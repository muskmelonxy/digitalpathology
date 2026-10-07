import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'react-query';
import axios from 'axios';
import OpenSeadragon from 'openseadragon';
import { useAuth } from '../contexts/AuthContext';
import ViewerChrome from '../components/ViewerChrome';
import ClinicalPanel from '../components/ClinicalPanel';
import WsiViewer from './WsiViewer';

function CenteredMessage({ title, body, to = '/slides', action = '返回课程切片' }) {
  return (
    <div className="h-full bg-paper flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h2 className="font-serif text-3xl text-ink">{title}</h2>
        {body ? <p className="mt-3 text-stone-600">{body}</p> : null}
        <Link to={to} className="btn-primary inline-block mt-6">{action}</Link>
      </div>
    </div>
  );
}

function PyramidViewer({ slide, slideInfo, token }) {
  const viewerRef = useRef(null);
  const osdRef = useRef(null);
  const [showInfo, setShowInfo] = useState(true);
  const [opened, setOpened] = useState(false);
  const [imageZoom, setImageZoom] = useState(null);
  const { data: siblings } = useQuery('slides', () =>
    axios.get('/api/slides').then((res) => res.data)
  );

  useEffect(() => {
    if (!slideInfo || !viewerRef.current) return undefined;
    let viewer;
    setOpened(false);
    const tileSource = {
      width: slideInfo.width,
      height: slideInfo.height,
      tileSize: slideInfo.tileSize,
      maxLevel: slideInfo.maxLevel,
      minLevel: 0,
      getTileUrl(level, x, y) {
        return `/api/tiles/${slide.id}/${level}/${x}/${y}.jpg?token=${token}`;
      },
    };
    viewer = OpenSeadragon({
      element: viewerRef.current,
      prefixUrl: `${process.env.PUBLIC_URL}/osd/`,
      tileSources: tileSource,
      showNavigationControl: false,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      navigatorHeight: 132,
      navigatorWidth: 176,
      navigatorAutoFade: false,
      navigatorBackground: 'rgba(16, 22, 20, 0.92)',
      navigatorBorderColor: 'rgba(231, 161, 90, 0.85)',
      navigatorDisplayRegionColor: '#e7a15a',
      maxZoomPixelRatio: 2,
      visibilityRatio: 0.6,
      constrainDuringPan: true,
      animationTime: 0.4,
    });
    osdRef.current = viewer;
    const observer = new ResizeObserver(() => viewer.forceResize());
    observer.observe(viewerRef.current);
    const publish = () => {
      if (!viewer.world.getItemCount()) return;
      setImageZoom(viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true)));
    };
    viewer.addHandler('open', () => {
      setOpened(true);
      viewer.forceResize();
      publish();
    });
    viewer.addHandler('zoom', publish);
    return () => {
      observer.disconnect();
      try {
        viewer.destroy();
      } catch (err) {
        // ignore teardown races
      }
      osdRef.current = null;
    };
  }, [slideInfo, slide.id, token]);

  const filmstrip = (siblings || []).filter((item) => item.status === 'ready').map((item) => ({
    key: item.id,
    name: item.name,
    src: item.thumbnail_path,
    active: String(item.id) === String(slide.id),
    href: `/slides/${item.id}`,
  }));

  return (
    <ViewerChrome
      title={slide.name}
      subtitle={slide.course_name || '课程切片'}
      viewerRef={osdRef}
      exportName={slide.name}
      backTo="/slides"
      readout={imageZoom ? `${imageZoom.toFixed(2)}×` : '—'}
      readoutHint="像素倍率"
      onZoomIn={() => osdRef.current?.viewport.zoomBy(1.4)}
      onZoomOut={() => osdRef.current?.viewport.zoomBy(1 / 1.4)}
      onHome={() => osdRef.current?.viewport.goHome(false)}
      showInfo={showInfo}
      onToggleInfo={() => setShowInfo((value) => !value)}
      filmstrip={filmstrip}
      loading={!opened}
      clinical={slide.filename ? (
        <ClinicalPanel root="uploads" filename={slide.filename} />
      ) : null}
      info={(
        <div className="meta-body">
          <dl>
            <div>
              <dt>尺寸 Dimensions</dt>
              <dd>{slide.width?.toLocaleString()} × {slide.height?.toLocaleString()} px</dd>
            </div>
            <div>
              <dt>格式 Format</dt>
              <dd className="uppercase">{slide.original_format}</dd>
            </div>
            <div>
              <dt>瓦片 Tile</dt>
              <dd>{slide.tile_size} px</dd>
            </div>
            <div>
              <dt>层数 Levels</dt>
              <dd>{(slide.max_level ?? 0) + 1}</dd>
            </div>
            <div>
              <dt>课程 Course</dt>
              <dd>{slide.course_name || '未分配'}</dd>
            </div>
            {slide.description ? (
              <div>
                <dt>说明 Notes</dt>
                <dd>{slide.description}</dd>
              </div>
            ) : null}
          </dl>
          <p className="meta-note">
            这张切片使用预先生成的金字塔。KFB / SVS 建议改用直读，以保留原始分辨率。
          </p>
        </div>
      )}
    >
      <div ref={viewerRef} className="osd-root" />
    </ViewerChrome>
  );
}

export default function SlideViewer() {
  const { id } = useParams();
  const { token } = useAuth();

  const { data: slide, isLoading: slideLoading } = useQuery(
    ['slide', id],
    () => axios.get(`/api/slides/${id}`).then((res) => res.data),
    { enabled: !!id }
  );

  const direct = slide?.view_mode === 'direct';

  const { data: slideInfo, isLoading: infoLoading } = useQuery(
    ['slideInfo', id],
    () => axios.get(`/api/slides/${id}/info`).then((res) => res.data),
    { enabled: !!id && !!slide && !direct && slide.status === 'ready' }
  );

  if (slideLoading || (!direct && slide?.status === 'ready' && infoLoading)) {
    return (
      <div className="h-full bg-[#121816] flex items-center justify-center">
        <div className="stage-spinner" />
      </div>
    );
  }

  if (!slide) {
    return <CenteredMessage title="找不到切片" body="这张玻片可能已删除。" />;
  }

  if (slide.status !== 'ready') {
    return (
      <CenteredMessage
        title={slide.status === 'error' ? '切片处理失败' : '切片还在处理'}
        body={slide.error_message || (slide.status === 'error'
          ? '请查看服务日志，或改用直读方式重新上传。'
          : '金字塔生成完成后即可查看。')}
      />
    );
  }

  if (direct) {
    return (
      <WsiViewer
        root="uploads"
        filename={slide.filename}
        backTo="/slides"
        title={slide.name}
        subtitle={[slide.course_name, '直读'].filter(Boolean).join(' · ')}
      />
    );
  }

  if (!slideInfo) {
    return <CenteredMessage title="切片信息缺失" body="无法读取金字塔尺寸。" />;
  }

  return <PyramidViewer slide={slide} slideInfo={slideInfo} token={token} />;
}
