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
  Maximize,
  Minimize
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function SlideViewer() {
  const { id } = useParams();
  const viewerRef = useRef(null);
  const osdRef = useRef(null);
  const [showInfo, setShowInfo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(1);
  const { token } = useAuth();

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

  useEffect(() => {
    if (!slideInfo || !viewerRef.current) return;

    console.log('SlideViewer: Initializing with slideInfo:', slideInfo);

    // Clean up previous viewer
    if (osdRef.current) {
      osdRef.current.destroy();
    }

    // Create custom tile source for our pyramid structure
    // Our pyramid structure matches OpenSeadragon's expectation:
    //   Level 0 = lowest resolution (overview, fewest tiles)
    //   Level maxLevel = highest resolution (original image, most tiles)
    const tileSource = {
      width: slideInfo.width,
      height: slideInfo.height,
      tileSize: slideInfo.tileSize,
      maxLevel: slideInfo.maxLevel,
      minLevel: 0,
      getTileUrl: function(level, x, y) {
        // OSD level 0 = lowest resolution
        // Our level 0 = lowest resolution (matches!)
        // Include token for authentication
        return `/api/tiles/${id}/${level}/${x}/${y}.jpg?token=${token}`;
      }
    };

    osdRef.current = OpenSeadragon({
      element: viewerRef.current,
      prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1.0/build/openseadragon/images/',
      showNavigationControl: false,
      maxZoomPixelRatio: 2,
      minZoomLevel: 0.1,
      visibilityRatio: 0.5,
      constrainDuringPan: true,
      animationTime: 0.5,
      springStiffness: 6,
      gestureSettingsMouse: {
        clickToZoom: true,
        dblClickToZoom: true,
        pinchToZoom: true,
        scrollToZoom: true
      },
      gestureSettingsTouch: {
        pinchToZoom: true,
        scrollToZoom: true
      }
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

    // Track zoom changes
    osdRef.current.addHandler('zoom', () => {
      setCurrentZoom(osdRef.current.viewport.getZoom());
    });

    // Log when viewer is ready
    osdRef.current.addHandler('open', () => {
      console.log('SlideViewer: OpenSeadragon viewer ready');
    });

    return () => {
      if (osdRef.current) {
        osdRef.current.destroy();
        osdRef.current = null;
      }
    };
  }, [slideInfo, id, token]);

  const handleZoomIn = () => {
    osdRef.current?.viewport.zoomBy(1.5);
  };

  const handleZoomOut = () => {
    osdRef.current?.viewport.zoomBy(0.667);
  };

  const handleReset = () => {
    osdRef.current?.viewport.goHome();
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
    <div className="h-[calc(100vh-100px)] flex flex-col">
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
              {Math.round(currentZoom * 100)}%
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
                <label className="text-sm text-gray-500">Name</label>
                <p className="text-sm font-medium text-gray-900">{slide.name}</p>
              </div>

              {slide.description && (
                <div>
                  <label className="text-sm text-gray-500">Description</label>
                  <p className="text-sm text-gray-900">{slide.description}</p>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-500">Course</label>
                <p className="text-sm font-medium text-gray-900">{slide.course_name || 'Not assigned'}</p>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">Technical Details</h4>

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

      {/* Thumbnail Strip */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        <div className="flex-shrink-0 w-32 aspect-video bg-gray-100 rounded-lg overflow-hidden border-2 border-blue-500">
          {slide.thumbnail_path && (
            <img src={slide.thumbnail_path} alt="" className="w-full h-full object-cover" />
          )}
        </div>
      </div>
    </div>
  );
}
