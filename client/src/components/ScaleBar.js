import React, { useEffect, useState } from 'react';

// 病理切片 µm 尺标(左下角): 依据 micro_per_px(微米/像素, kfb CapRes) 与当前视野
// 实时计算一条"取整"长度(5/10/20/25/50/100/200/500/1000µm)的水平标尺。
export default function ScaleBar({ viewerRef, microPerPx, osdReady }) {
  const [bar, setBar] = useState(null);

  useEffect(() => {
    if (!viewerRef.current || !microPerPx) { setBar(null); return; }
    const update = () => {
      const v = viewerRef.current;
      if (!v) return;
      const bounds = v.viewport.getBounds();
      const cw = v.container.clientWidth || 1;
      // 当前一屏: bounds.width 个图像像素铺满 cw 个屏幕像素 => µm/屏幕px
      const umPerPx = (bounds.width / cw) * microPerPx;
      if (!(umPerPx > 0)) return;
      for (const c of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) {
        const px = c / umPerPx;
        if (px >= 55 && px <= 230) { setBar({ px, um: c }); return; }
      }
      // 兜底: 取 ≤5000µm 最长者, 宽度限制在 260px
      const c = 1000; // 默认
      const px = Math.min(260, c / umPerPx);
      setBar({ px, um: c });
    };
    update();
    let handler = update;
    const v = viewerRef.current;
    v.addHandler('update-viewport', handler);
    return () => { try { v.removeHandler('update-viewport', handler); } catch (e) {} };
  }, [viewerRef, microPerPx, osdReady]);

  if (!bar || !microPerPx) return null;

  return (
    <div className="absolute bottom-4 right-4 z-10 flex flex-col items-center bg-black/40 rounded px-2 py-1 select-none" title="当前视野内的实际尺寸标尺">
      <div style={{ width: bar.px, height: 3, background: '#fff' }}
           className="border-x border-white box-content" />
      <span className="text-white text-xs mt-0.5 leading-tight">{bar.um} µm</span>
    </div>
  );
}