import React from 'react';
import { Home, ZoomIn, ZoomOut } from 'lucide-react';

// Bottom-left zoom control: a ratio slider + quick-magnification preset buttons.
// `multiple` is the zoom expressed as a multiple of the whole-slide (home=1x) view.
const PRESETS = [0.5, 1, 2, 4, 10, 20];

export default function ZoomControls({ multiple, onSetMultiple, onZoomIn, onZoomOut, onHome }) {
  const pct = Math.round(multiple * 100);
  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10">
      {/* Preset buttons */}
      <div className="flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 p-1.5">
        {PRESETS.map((m) => (
          <button
            key={m}
            onClick={() => onSetMultiple(m)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              Math.abs(multiple - m) < 0.02
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={`${m}x 放大`}
          >
            {m}x
          </button>
        ))}
      </div>

      {/* Slider + readout + zoom buttons */}
      <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 px-3 py-2">
        <button onClick={onHome} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="全片视图(1x)">
          <Home className="w-4 h-4" />
        </button>
        <button onClick={onZoomOut} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="缩小">
          <ZoomOut className="w-4 h-4" />
        </button>
        <input
          type="range"
          min="0.1"
          max="20"
          step="0.1"
          value={multiple}
          onChange={(e) => onSetMultiple(parseFloat(e.target.value))}
          className="w-32 accent-blue-600"
          title="缩放比例"
        />
        <button onClick={onZoomIn} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="放大">
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-xs font-medium text-gray-700 min-w-[52px] text-right tabular-nums">
          {pct}%
        </span>
      </div>
    </div>
  );
}
