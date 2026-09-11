import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import axios from 'axios';
import OpenSeadragon from 'openseadragon';
import { useAuth } from '../contexts/AuthContext';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Info,
  Share2,
  Maximize,
  Minimize
} from 'lucide-react';
import toast from 'react-hot-toast';
import ShareModal from '../components/ShareModal';
import ZoomControls from '../components/ZoomControls';
import ColorAdjust, { defaultColor, applyColorToViewer } from '../components/ColorAdjust';
import ScaleBar from '../components/ScaleBar';

export default function SlideViewer() {
  const { id } = useParams();
  const viewerRef = useRef(null);
  const osdRef = useRef(null);
  const [showInfo, setShowInfo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [, setCurrentZoom] = useState(1);
  const homeZoomRef = useRef(null);
  const [multiple, setMultiple] = useState(1);
  const [shareOpen, setShareOpen] = useState(false);
  const [overviewOk, setOverviewOk] = useState(false);
  const [color, setColor] = useState(defaultColor);
  const colorRef = useRef(defaultColor);
  const [osdReady, setOsdReady] = useState(false);
  const { user, token } = useAuth();

  const { data: slide, isLoading: slideLoading } = useQuery(
    ['slide', id],
    () => axios.get(`/api/slides/${id}`).then(res => res.data),
    { enabled: !!id }
  );

  const { data: slideInfo, isLoading: infoLoading } = useQuery(
    ['slideInfo', id],
    () => axios.get(`/api/slides/${id}/info`).then(res => res.data),
    { enabled: !!id }
  );

  // Prefetch the crisp whole-slide overview; use it as the first-paint
  // placeholder if it exists, else fall back to the small thumbnail.
  useEffect(() => {
    if (!id) return;
    setOverviewOk(false);
    const img = new Image();
    img.onload = () => setOverviewOk(true);
    img.onerror = () => setOverviewOk(false);
    img.src = `/uploads/overviews/${id}.jpg`;
  }, [id]);

  const placeholderSrc = overviewOk
    ? `/uploads/overviews/${id}.jpg`
    : (slide?.thumbnail_path);

  useEffect(() => {
    if (!slideInfo || !viewerRef.current) return;

    console.log('SlideViewer: Initializing with slideInfo:', slideInfo);

    // Clean up previous viewer
    if (osdRef.current) {
      osdRef.current.destroy();
    }

    // Custom tile source for our pyramid structure using STATIC path (fast)
    //
    // Server pyramid: level 0 = lowest resolution, maxLevel = full resolution.
    // OpenSeadragon convention: level 0 = FULL resolution, higher = lower.
    // We invert the mapping (getTileUrl + getLevelScale) so OSD loads the
    // low-res overview first, then progressively refines local regions on
    // zoom — the standard deep-zoom behavior for whole-slide images.
    const maxLevel = slideInfo.maxLevel;
    const tileSource = {
      width: slideInfo.width,
      height: slideInfo.height,
      tileSize: slideInfo.tileSize,
      minLevel: 0,
      maxLevel: maxLevel,
      getLevelScale: function(level) {
        // OSD convention: level 0 = full resolution, each level halves it
        return 1 / Math.pow(2, level);
      },
      getNumTiles: function(level) {
        const scale = Math.pow(2, level);
        return {
          x: Math.max(1, Math.ceil(slideInfo.width / scale / slideInfo.tileSize)),
          y: Math.max(1, Math.ceil(slideInfo.height / scale / slideInfo.tileSize))
        };
      },
      getTileUrl: function(level, x, y) {
        // Use direct static file path - no auth overhead, cached for 7 days
        const serverLevel = maxLevel - level;
        // 缓存失效版本号: 重新生成瓦片后递增, 浏览器不再复用旧缓存瓦片
        return `/tiles/${id}/${serverLevel}/${x}_${y}.jpg?v=20260825`;
      }
    };

    osdRef.current = OpenSeadragon({
      element: viewerRef.current,
      prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1.0/build/openseadragon/images/',
      showNavigationControl: false,
      maxZoomPixelRatio: 20,        // allow deep digital zoom (no hard 2x cap on native px)
      minZoomLevel: 0.1,
      visibilityRatio: 0.5,
      constrainDuringPan: true,
      // ---- Performance tuning for progressive deep-zoom ----
      animationTime: 0.25,          // snappier pan/zoom response
      springStiffness: 8,
      imageLoaderLimit: 24,          // more parallel tile fetches (12-core server)
      timeout: 15000,
      tileRetry: 3,                  // retry transient tile failures
      maxImageCacheCount: 500,       // keep more tiles cached (fast zoom-out)
      preload: true,                 // prefetch adjacent tiles while panning
      blendTime: 0.05,               // quick tile fade-in (less "fuzzy" wait)
      placeholder: placeholderSrc, // instant low-res first paint (crisp overview)
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
      // ---- Floating minimap (左上角悬浮总览, 参考站观感) ----
      showNavigator: true,
      navigatorPosition: 'TOP_LEFT',
      navigatorSizeRatio: 0.16,
      navigatorAutoResize: true
    });

    // Open the tile source explicitly
    osdRef.current.open(tileSource);

    // Handle tile load errors
    osdRef.current.addHandler('tile-load-failed', (event) => {
      console.error('Tile load failed:', event);
    });

    // Handle open errors
    osdRef.current.addHandler('open-failed', (event) => {
      console.error('Open failed:', event);
    });

    // Track zoom changes (as a multiple of the whole-slide/home view)
    osdRef.current.addHandler('zoom', () => {
      const z = osdRef.current.viewport.getZoom();
      setCurrentZoom(z);
      const hz = homeZoomRef.current;
      if (hz) setMultiple(Math.round((z / hz) * 100) / 100);
    });

    // Capture the whole-slide (home) zoom as the 1x baseline for presets/slider
    osdRef.current.addHandler('open', () => {
      const hz = osdRef.current.viewport.getZoom();
      homeZoomRef.current = hz;
      setCurrentZoom(hz);
      setMultiple(1);
      applyColorToViewer(osdRef.current, colorRef.current);
      setOsdReady(true);
      console.log('SlideViewer: OpenSeadragon viewer ready, home zoom', hz);
    });

    return () => {
      if (osdRef.current) {
        osdRef.current.destroy();
        osdRef.current = null;
      }
    };
  }, [slideInfo, slide, id, token, overviewOk]);

  // Apply color adjustments live (brightness/contrast/gamma/grayscale/invert)
  useEffect(() => {
    colorRef.current = color;
    applyColorToViewer(osdRef.current, color);
  }, [color]);

  const handleZoomIn = () => {
    osdRef.current?.viewport.zoomBy(1.5);
  };

  const handleZoomOut = () => {
    osdRef.current?.viewport.zoomBy(0.667);
  };

  const handleReset = () => {
    osdRef.current?.viewport.goHome();
  };

  const handleSetMultiple = (m) => {
    const hz = homeZoomRef.current;
    if (!hz) return;
    osdRef.current?.viewport.zoomTo(hz * m);
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      viewerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  if (slideLoading || infoLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!slide || !slideInfo) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-gray-900">Slide not found</h2>
        <Link to="/slides" className="btn-primary inline-block mt-4">
          Back to Slides
        </Link>
      </div>
    );
  }

  if (slide.status !== 'ready') {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-gray-900">Slide not ready</h2>
        <p className="text-gray-600 mt-2">This slide is still being processed</p>
        <Link to="/slides" className="btn-primary inline-block mt-4">
          Back to Slides
        </Link>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-85px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link to="/slides" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{slide.name}</h1>
            <p className="text-sm text-gray-500">{slide.course_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <ColorAdjust value={color} onChange={setColor} />
          </div>
          {user?.role !== 'student' && (
            <button
              onClick={() => setShareOpen(true)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-700"
              title="分享切片"
            >
              <Share2 className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`p-2 rounded-lg transition-colors ${showInfo ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Viewer Area */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Viewer */}
        <div className="flex-1 relative bg-gray-900 rounded-lg overflow-hidden">
          <div ref={viewerRef} className="w-full h-full" />

          {/* Controls Overlay */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur rounded-lg shadow-lg p-2">
            <button onClick={handleZoomOut} className="p-2 hover:bg-gray-100 rounded" title="Zoom Out">
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium min-w-[60px] text-center">
              {Math.round(multiple * 100)}%
            </span>
            <button onClick={handleZoomIn} className="p-2 hover:bg-gray-100 rounded" title="Zoom In">
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-gray-300 mx-1" />
            <button onClick={handleReset} className="p-2 hover:bg-gray-100 rounded" title="Reset View">
              <RotateCcw className="w-5 h-5" />
            </button>
            <button onClick={handleFullscreen} className="p-2 hover:bg-gray-100 rounded" title="Fullscreen">
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>

          {/* Zoom slider + magnification presets (bottom-left) */}
          <ZoomControls
            multiple={multiple}
            onSetMultiple={handleSetMultiple}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onHome={handleReset}
          />

          {/* µm 尺标 (bottom-right) */}
          <ScaleBar viewerRef={osdRef} microPerPx={slide.micro_per_px} osdReady={osdReady} />

          {/* Navigation Overlay */}
          <div className="absolute top-1/2 left-4 -translate-y-1/2">
            <button className="p-2 bg-white/90 backdrop-blur rounded-lg shadow hover:bg-white">
              <span className="sr-only">Previous</span>
              &#8249;
            </button>
          </div>
          <div className="absolute top-1/2 right-4 -translate-y-1/2">
            <button className="p-2 bg-white/90 backdrop-blur rounded-lg shadow hover:bg-white">
              <span className="sr-only">Next</span>
              &#8250;
            </button>
          </div>
        </div>

        {/* Info Sidebar */}
        {showInfo && (
          <div className="w-80 bg-white rounded-lg shadow p-6 overflow-y-auto">
            <h3 className="font-semibold text-gray-900 mb-4">Slide Information</h3>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-500">名称</label>
                <p className="text-sm font-medium text-gray-900">{slide.name}</p>
              </div>

              {slide.description && (
                <div>
                  <label className="text-sm text-gray-500">描述</label>
                  <p className="text-sm text-gray-900">{slide.description}</p>
                </div>
              )}

              {/* Clinical Information */}
              {(slide.gender || slide.age || slide.diagnosis || slide.other_info || slide.case_no || slide.sampling_site || slide.institution || slide.microscopic || slide.ihc) && (
                <div className="border-t pt-4">
                  <h4 className="font-medium text-gray-900 mb-3">病例信息</h4>
                  <div className="space-y-2 text-sm">
                    {slide.case_no && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">病理号</span>
                        <span className="font-medium">{slide.case_no}</span>
                      </div>
                    )}
                    {slide.sampling_site && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">取材部位</span>
                        <span className="font-medium">{slide.sampling_site}</span>
                      </div>
                    )}
                    {slide.institution && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">医疗机构</span>
                        <span className="font-medium">{slide.institution}</span>
                      </div>
                    )}
                    {slide.gender && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">性别</span>
                        <span className="font-medium">{slide.gender}</span>
                      </div>
                    )}
                    {slide.age && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">年龄</span>
                        <span className="font-medium">{slide.age}</span>
                      </div>
                    )}
                    {slide.diagnosis && (
                      <div>
                        <span className="text-gray-500 block">诊断</span>
                        <span className="font-medium">{slide.diagnosis}</span>
                      </div>
                    )}
                    {slide.microscopic && (
                      <div>
                        <span className="text-gray-500 block">镜下所见</span>
                        <span className="font-medium whitespace-pre-wrap">{slide.microscopic}</span>
                      </div>
                    )}
                    {slide.ihc && (
                      <div>
                        <span className="text-gray-500 block">免疫组化</span>
                        <span className="font-medium whitespace-pre-wrap">{slide.ihc}</span>
                      </div>
                    )}
                    {slide.other_info && (
                      <div>
                        <span className="text-gray-500 block">备注</span>
                        <span className="font-medium">{slide.other_info}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-500">课程</label>
                <p className="text-sm font-medium text-gray-900">{slide.course_name || '未分配'}</p>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">技术参数</h4>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="text-gray-500">Dimensions</label>
                    <p className="font-medium">{slide.width.toLocaleString()} × {slide.height.toLocaleString()} px</p>
                  </div>
                  <div>
                    <label className="text-gray-500">Format</label>
                    <p className="font-medium uppercase">{slide.original_format}</p>
                  </div>
                  <div>
                    <label className="text-gray-500">Tile Size</label>
                    <p className="font-medium">{slide.tile_size} px</p>
                  </div>
                  <div>
                    <label className="text-gray-500">Zoom Levels</label>
                    <p className="font-medium">{slide.max_level + 1}</p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm text-gray-500">Uploaded</label>
                <p className="text-sm text-gray-900">
                  {new Date(slide.created_at).toLocaleDateString()} by {slide.uploaded_by_name}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Share Modal */}
      {shareOpen && (
        <ShareModal slideId={slide.id} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
