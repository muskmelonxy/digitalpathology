import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import OpenSeadragon from 'openseadragon';
import { ZoomIn, ZoomOut, RotateCcw, Info, Maximize, Minimize } from 'lucide-react';
import OverviewMap from '../components/OverviewMap';
import ZoomControls from '../components/ZoomControls';
import ColorAdjust, { defaultColor, applyColorToViewer } from '../components/ColorAdjust';
import ScaleBar from '../components/ScaleBar';
import {
  buildTileSource,
  buildOsdOptions,
  applyViewportHash,
  bindViewportHash,
  placeholderStyle,
  currentMagnification,
  zoomForMagnification,
  MAG_PRESETS
} from '../lib/osdConfig';

// Public read-only slide viewer, opened via a share link (/s/:token).
// No authentication required — tile + thumbnail assets are served statically.
export default function PublicViewer() {
  const { token } = useParams();
  const viewerRef = useRef(null);
  const osdRef = useRef(null);
  const [slide, setSlide] = useState(null);
  const [error, setError] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [, setCurrentZoom] = useState(1);
  const homeZoomRef = useRef(null);
  const [multiple, setMultiple] = useState(1);
  const [overviewOk, setOverviewOk] = useState(false);
  const [color, setColor] = useState(defaultColor);
  const colorRef = useRef(defaultColor);
  const [osdReady, setOsdReady] = useState(false);

  useEffect(() => {
    axios.get(`/api/share/public/${token}`)
      .then(res => setSlide(res.data))
      .catch(err => {
        setError(err.response?.data?.error || '无法加载分享的切片');
      });
  }, [token]);

  // Prefetch crisp whole-slide overview for first paint; fall back to thumbnail.
  useEffect(() => {
    if (!slide) return;
    setOverviewOk(false);
    const img = new Image();
    img.onload = () => setOverviewOk(true);
    img.onerror = () => setOverviewOk(false);
    img.src = `/uploads/overviews/${slide.id}.jpg`;
  }, [slide]);

  const placeholderSrc = slide && overviewOk
    ? `/uploads/overviews/${slide.id}.jpg`
    : (slide?.thumbnail_path);

  useEffect(() => {
    if (!slide) return;
    if (!viewerRef.current) return;

    if (osdRef.current) {
      osdRef.current.destroy();
      osdRef.current = null;
    }

    const tileSource = buildTileSource({
      id: slide.id,
      width: slide.width,
      height: slide.height,
      tileSize: slide.tile_size,
      maxLevel: slide.max_level,
      tilesVersion: slide.tiles_version || 1
    });

    osdRef.current = OpenSeadragon(buildOsdOptions(viewerRef.current));
    osdRef.current.open(tileSource);

    osdRef.current.addHandler('zoom', () => {
      const z = osdRef.current.viewport.getZoom();
      setCurrentZoom(z);
      setMultiple(Math.round(currentMagnification(osdRef.current) * 10) / 10);
    });

    let unbindHash = () => {};
    osdRef.current.addHandler('open', () => {
      const hz = osdRef.current.viewport.getZoom();
      homeZoomRef.current = hz;
      setCurrentZoom(hz);
      setMultiple(1);
      applyColorToViewer(osdRef.current, colorRef.current);
      const usedHash = applyViewportHash(osdRef.current);
      unbindHash = bindViewportHash(osdRef.current);
      setMultiple(Math.round(currentMagnification(osdRef.current) * 10) / 10);
      if (usedHash) {
        const z = osdRef.current.viewport.getZoom();
        setCurrentZoom(z);
        setMultiple(Math.round(currentMagnification(osdRef.current) * 10) / 10);
      }
      setOsdReady(true);
    });

    return () => {
      unbindHash();
      if (osdRef.current) {
        osdRef.current.destroy();
        osdRef.current = null;
      }
    };
  }, [slide]);

  // Apply color adjustments live (brightness/contrast/gamma/grayscale/invert)
  useEffect(() => {
    colorRef.current = color;
    applyColorToViewer(osdRef.current, color);
  }, [color]);

  const handleZoomIn = () => osdRef.current?.viewport.zoomBy(1.5);
  const handleZoomOut = () => osdRef.current?.viewport.zoomBy(0.667);
  const handleReset = () => osdRef.current?.viewport.goHome();
  const handleSetMultiple = (m) => {
    if (!osdRef.current) return;
    osdRef.current.viewport.zoomTo(zoomForMagnification(osdRef.current, m));
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

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">分享链接无效</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link to="/login" className="btn-secondary inline-flex items-center justify-center">返回登录</Link>
        </div>
      </div>
    );
  }

  if (!slide) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{slide.name}</h1>
          {slide.course_name && (
            <span className="text-sm text-gray-500 flex-shrink-0">{slide.course_name}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <ColorAdjust value={color} onChange={setColor} />
          </div>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`p-2 rounded-lg transition-colors ${showInfo ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
            title="切片信息"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Viewer area */}
      <div className="h-[calc(100vh-57px)] flex gap-4 p-4 overflow-hidden">
        <div className="flex-1 relative bg-gray-900 rounded-lg overflow-hidden">
          <div ref={viewerRef} className="w-full h-full" style={placeholderStyle(placeholderSrc)} />

          <OverviewMap
            overviewSrc={placeholderSrc}
            labelSrc={slide.has_label ? `/uploads/labels/${slide.id}.jpg` : null}
            width={slide.width}
            height={slide.height}
            viewerRef={osdRef}
            osdReady={osdReady}
            presets={MAG_PRESETS}
            magnification={multiple}
            onSetMagnification={handleSetMultiple}
          />

          <ScaleBar viewerRef={osdRef} microPerPx={slide.micro_per_px} osdReady={osdReady} />

          {/* Zoom slider + magnification presets (bottom-left) */}
          <ZoomControls
            magnification={multiple}
            onSetMagnification={handleSetMultiple}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onHome={handleReset}
          />

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/90 backdrop-blur rounded-lg shadow-lg p-2">
            <button onClick={handleZoomOut} className="p-2 hover:bg-gray-100 rounded" title="缩小">
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium min-w-[60px] text-center">
              {multiple >= 10 ? `${Math.round(multiple)}×` : `${Number(multiple).toFixed(1)}×`}
            </span>
            <button onClick={handleZoomIn} className="p-2 hover:bg-gray-100 rounded" title="放大">
              <ZoomIn className="w-5 h-5" />
            </button>
            <div className="w-px h-6 bg-gray-300 mx-1" />
            <button onClick={handleReset} className="p-2 hover:bg-gray-100 rounded" title="复位">
              <RotateCcw className="w-5 h-5" />
            </button>
            <button onClick={handleFullscreen} className="p-2 hover:bg-gray-100 rounded" title="全屏">
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {showInfo && (
          <div className="w-80 bg-white rounded-lg shadow p-6 overflow-y-auto flex-shrink-0">
            <h3 className="font-semibold text-gray-900 mb-4">切片信息</h3>
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

              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">技术参数</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="text-gray-500">尺寸</label>
                    <p className="font-medium">{slide.width.toLocaleString()} × {slide.height.toLocaleString()}</p>
                  </div>
                  <div>
                    <label className="text-gray-500">格式</label>
                    <p className="font-medium uppercase">{slide.original_format}</p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 text-xs text-gray-400">
                由 {slide.uploaded_by_name} 分享
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
