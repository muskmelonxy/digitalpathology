import React, { useEffect, useState } from 'react';

function formatLength(um) {
  if (um >= 1000) {
    const mm = um / 1000;
    return mm >= 10 ? `${Math.round(mm)} mm` : `${mm.toFixed(1)} mm`;
  }
  return `${um} µm`;
}

// Pathology scale bar: µm at high zoom, mm at whole-slide FOV.
export default function ScaleBar({ viewerRef, microPerPx, osdReady }) {
  const [bar, setBar] = useState(null);

  useEffect(() => {
    if (!viewerRef.current || !microPerPx) { setBar(null); return; }
    const update = () => {
      const v = viewerRef.current;
      if (!v) return;
      const bounds = v.viewport.getBounds();
      const cw = v.container.clientWidth || 1;
      const umPerPx = (bounds.width / cw) * microPerPx;
      if (!(umPerPx > 0)) return;
      const candidates = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
      for (const c of candidates) {
        const px = c / umPerPx;
        if (px >= 55 && px <= 230) { setBar({ px, um: c }); return; }
      }
      const c = umPerPx * 120;
      const snapped = candidates.reduce((best, n) => Math.abs(n - c) < Math.abs(best - c) ? n : best, candidates[0]);
      const px = Math.min(260, Math.max(40, snapped / umPerPx));
      setBar({ px, um: snapped });
    };
    update();
    const v = viewerRef.current;
    v.addHandler('update-viewport', update);
    return () => { try { v.removeHandler('update-viewport', update); } catch (e) {} };
  }, [viewerRef, microPerPx, osdReady]);

  if (!bar || !microPerPx) return null;

  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col items-center bg-black/40 rounded px-2 py-1 select-none" title="Field scale">
      <div style={{ width: bar.px, height: 3, background: '#fff' }}
           className="border-x border-white box-content" />
      <span className="text-white text-xs mt-0.5 leading-tight">{formatLength(bar.um)}</span>
    </div>
  );
}
