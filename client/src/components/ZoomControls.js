import React from 'react';
import { Home, ZoomIn, ZoomOut } from 'lucide-react';
import { MAG_PRESETS } from '../lib/osdConfig';

// Bottom-left zoom: slider in optical-ish × (40× ≈ native 1:1 pixels).
export default function ZoomControls({
  magnification,
  onSetMagnification,
  onZoomIn,
  onZoomOut,
  onHome,
  showPresets = false
}) {
  const mag = Number(magnification) || 1;
  const sliderMax = 40;
  const sliderMin = 0.3;
  const sliderVal = Math.max(sliderMin, Math.min(sliderMax, mag));
  const label = mag >= 10 ? `${Math.round(mag)}×` : `${mag.toFixed(1)}×`;

  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10">
      {showPresets && (
        <div className="flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 p-1.5">
          {MAG_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSetMagnification(m)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                Math.abs(mag - m) / m < 0.12
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={`${m}×`}
            >
              {m}×
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 px-3 py-2">
        <button type="button" onClick={onHome} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="Fit slide">
          <Home className="w-4 h-4" />
        </button>
        <button type="button" onClick={onZoomOut} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step="0.1"
          value={sliderVal}
          onChange={(e) => onSetMagnification(parseFloat(e.target.value))}
          className="w-32 accent-blue-600"
          title="Magnification"
        />
        <button type="button" onClick={onZoomIn} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium text-gray-700 min-w-[44px] text-right tabular-nums">
          {label}
        </span>
      </div>
    </div>
  );
}
