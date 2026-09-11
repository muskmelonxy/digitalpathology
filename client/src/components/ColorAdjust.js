import React, { useState } from 'react';
import { Settings2, SlidersHorizontal, Sun, Contrast, Droplet, Aperture, FlipHorizontal2, RotateCcw } from 'lucide-react';

// Default neutral color settings.
export const defaultColor = { brightness: 1, contrast: 1, saturation: 1, gamma: 1, grayscale: 0, invert: 0 };

// Single hidden SVG gamma filter (referenced by url(#dp-gamma)). OSD v4 removed
// setFilter(), so we drive color per-frame straight off the compositor canvas CSS
// `filter` — the style persists across tile redraws (only the pixels are repainted).
function ensureGammaFilter(gamma) {
  let svg = document.getElementById('dp-gamma-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'dp-gamma-svg';
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.left = '-10000px';
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.id = 'dp-gamma';
    const ct = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
    for (const ch of ['feFuncR', 'feFuncG', 'feFuncB']) {
      const f = document.createElementNS('http://www.w3.org/2000/svg', ch);
      f.setAttribute('type', 'gamma');
      f.setAttribute('exponent', String(gamma || 1));
      ct.appendChild(f);
    }
    filter.appendChild(ct);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);
  } else {
    const fe = svg.querySelectorAll('feComponentTransfer feFuncR, feComponentTransfer feFuncG, feComponentTransfer feFuncB');
    fe.forEach(n => n.setAttribute('exponent', String(gamma || 1)));
  }
}

// Build the CSS `filter` string from a settings object.
export function buildColorFilter(c) {
  const cc = { ...defaultColor, ...c };
  const parts = [];
  if (cc.gamma && cc.gamma !== 1) {
    ensureGammaFilter(cc.gamma);
    parts.push('url(#dp-gamma)');
  }
  if (cc.brightness !== 1) parts.push(`brightness(${cc.brightness})`);
  if (cc.contrast !== 1) parts.push(`contrast(${cc.contrast})`);
  if (cc.saturation !== 1) parts.push(`saturate(${cc.saturation})`);
  if (cc.grayscale) parts.push('grayscale(1)');
  if (cc.invert) parts.push('invert(1)');
  return parts.join(' ') || 'none';
}

// Apply a color settings object to an OpenSeadragon viewer (OSD v4).
export function applyColorToViewer(viewer, c) {
  if (!viewer) return;
  const canvas = viewer.drawer?.canvas || viewer.canvas;
  if (!canvas) return;
  canvas.style.filter = buildColorFilter(c);
}

const control = 'w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer';
const label = 'text-xs text-gray-500 flex items-center gap-1';

export default function ColorAdjust({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const set = (patch) => onChange({ ...value, ...patch });
  const toggle = (key) => set({ [key]: value[key] ? 0 : 1 });
  const reset = () => onChange({ ...defaultColor });

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="颜色调节"
        className={`p-2 rounded-lg transition-colors ${open ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`}
      >
        <Settings2 className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute top-14 right-0 w-64 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-900">颜色调节</span>
            <button onClick={reset} title="重置" className="p-1 hover:bg-gray-100 rounded text-gray-600">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={() => toggle('grayscale')}
              className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded ${value.grayscale ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Aperture className="w-3.5 h-3.5" /> 灰度
            </button>
            <button
              onClick={() => toggle('invert')}
              className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded ${value.invert ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <FlipHorizontal2 className="w-3.5 h-3.5" /> 反转
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className={label}><Sun className="w-3.5 h-3.5" /> 亮度 {value.brightness.toFixed(2)}</label>
              <input type="range" min="0.4" max="2" step="0.01" value={value.brightness}
                onChange={e => set({ brightness: parseFloat(e.target.value) })} className={control} />
            </div>
            <div>
              <label className={label}><Contrast className="w-3.5 h-3.5" /> 对比度 {value.contrast.toFixed(2)}</label>
              <input type="range" min="0.4" max="2" step="0.01" value={value.contrast}
                onChange={e => set({ contrast: parseFloat(e.target.value) })} className={control} />
            </div>
            <div>
              <label className={label}><Droplet className="w-3.5 h-3.5" /> 饱和度 {value.saturation.toFixed(2)}</label>
              <input type="range" min="0" max="2" step="0.01" value={value.saturation}
                onChange={e => set({ saturation: parseFloat(e.target.value) })} className={control} />
            </div>
            <div>
              <label className={label}><SlidersHorizontal className="w-3.5 h-3.5" /> 伽马 {value.gamma.toFixed(2)}</label>
              <input type="range" min="0.4" max="2.4" step="0.05" value={value.gamma}
                onChange={e => set({ gamma: parseFloat(e.target.value) })} className={control} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}