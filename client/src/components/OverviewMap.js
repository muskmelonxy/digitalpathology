import React, { useEffect, useRef, useState } from 'react';

/**
 * Static overview navigator (no extra OSD tile fetches) + optional label
 * thumbnail with a click-to-magnify overlay. Red rectangle tracks the viewport.
 */
export default function OverviewMap({
  overviewSrc,
  labelSrc,
  width,
  height,
  viewerRef,
  osdReady,
  presets,
  magnification,
  onSetMagnification
}) {
  const mapRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [showLabel, setShowLabel] = useState(false);
  const [labelScale, setLabelScale] = useState(1);

  useEffect(() => {
    if (!osdReady || !viewerRef.current || !width || !height) return;
    const viewer = viewerRef.current;
    const update = () => {
      try {
        const imgRect = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds());
        const left = (imgRect.x / width) * 100;
        const top = (imgRect.y / height) * 100;
        const w = (imgRect.width / width) * 100;
        const h = (imgRect.height / height) * 100;
        setRect({
          left: `${Math.max(-5, left)}%`,
          top: `${Math.max(-5, top)}%`,
          width: `${Math.max(2, Math.min(110, w))}%`,
          height: `${Math.max(2, Math.min(110, h))}%`
        });
      } catch (e) { /* viewer not ready */ }
    };
    update();
    viewer.addHandler('update-viewport', update);
    viewer.addHandler('open', update);
    return () => {
      try { viewer.removeHandler('update-viewport', update); } catch (e) {}
      try { viewer.removeHandler('open', update); } catch (e) {}
    };
  }, [osdReady, viewerRef, width, height]);

  const onMapClick = (e) => {
    const viewer = viewerRef.current;
    const el = mapRef.current;
    if (!viewer || !el || !width || !height) return;
    const box = el.getBoundingClientRect();
    const nx = (e.clientX - box.left) / box.width;
    const ny = (e.clientY - box.top) / box.height;
    const imagePt = viewer.viewport.imageToViewportCoordinates(nx * width, ny * height);
    viewer.viewport.panTo(imagePt);
  };

  if (!overviewSrc && !labelSrc) return null;

  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col gap-1 select-none" style={{ width: 176 }}>
      {overviewSrc && (
        <div className="bg-black/80 rounded shadow-lg border border-white/20 p-1">
          <div
            ref={mapRef}
            onClick={onMapClick}
            className="relative cursor-crosshair"
            title="Overview — click to pan"
          >
            <img src={overviewSrc} alt="" className="w-full block pointer-events-none" />
            {rect && (
              <div
                className="absolute pointer-events-none"
                style={{
                  ...rect,
                  outline: '2px solid #ef4444',
                  outlineOffset: '-2px',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.85)'
                }}
              />
            )}
          </div>
        </div>
      )}

      {presets && presets.length > 0 && (
        <div className="flex flex-nowrap justify-between gap-px bg-black/70 rounded px-0.5 py-1">
          {presets.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSetMagnification && onSetMagnification(m)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                Math.abs((magnification || 0) - m) / m < 0.12
                  ? 'bg-red-600 text-white'
                  : 'bg-white/90 text-gray-800 hover:bg-white'
              }`}
              title={`${m}×`}
            >
              {m}×
            </button>
          ))}
        </div>
      )}

      {labelSrc && (
        <button
          type="button"
          onClick={() => { setShowLabel(true); setLabelScale(1); }}
          className="bg-black rounded overflow-hidden shadow-lg border border-white/20 text-left"
          title="Slide label — click to magnify"
        >
          <img src={labelSrc} alt="label" className="w-full block" />
        </button>
      )}

      {showLabel && labelSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
          onClick={() => setShowLabel(false)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] bg-black rounded shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.preventDefault();
              const next = e.deltaY < 0 ? labelScale * 1.15 : labelScale / 1.15;
              setLabelScale(Math.max(0.5, Math.min(8, next)));
            }}
          >
            <img
              src={labelSrc}
              alt="label"
              className="block max-w-[80vw] max-h-[80vh] object-contain origin-center"
              style={{ transform: `scale(${labelScale})` }}
              draggable={false}
            />
            <button
              type="button"
              onClick={() => setShowLabel(false)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white text-lg leading-8"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
