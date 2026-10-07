/** Capture the current OpenSeadragon viewport, not the page chrome. */

export function snapshotFilename(slideName, readout, mime) {
  const safe = String(slideName || 'slide')
    .replace(/[\\/:*?"<>|\u0000]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'slide';
  const zoom = String(readout || '')
    .replace(/×/g, 'x')
    .replace(/[^\w.]+/g, '')
    .slice(0, 24) || 'view';
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  return `${safe}_${zoom}.${ext}`;
}

function viewerCanvas(viewer) {
  const canvas = viewer && viewer.drawer && viewer.drawer.canvas;
  if (canvas && canvas.getContext && canvas.width > 1 && canvas.height > 1) {
    return canvas;
  }
  return null;
}

function drawScaleBar(ctx, canvas, scaleBar) {
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = canvas.clientHeight || canvas.height;
  const scaleX = canvas.width / cssWidth;
  const scaleY = canvas.height / cssHeight;
  const barCss = Math.max(48, Math.min(Number(scaleBar.px) || 80, 280));
  const left = 16 * scaleX;
  const bottom = 16 * scaleY;
  const width = barCss * scaleX;
  const tick = 8 * scaleY;
  const yBottom = canvas.height - bottom;
  const yTop = yBottom - tick;

  ctx.save();
  ctx.strokeStyle = '#f6f1e8';
  ctx.fillStyle = '#f6f1e8';
  ctx.lineWidth = Math.max(2 * scaleX, 1);
  ctx.lineJoin = 'miter';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 1.5 * scaleX;
  ctx.beginPath();
  ctx.moveTo(left, yTop);
  ctx.lineTo(left, yBottom);
  ctx.lineTo(left + width, yBottom);
  ctx.lineTo(left + width, yTop);
  ctx.stroke();

  const fontSize = Math.max(12 * scaleY, 10);
  ctx.font = `600 ${fontSize}px Figtree, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 2 * scaleX;
  ctx.fillText(String(scaleBar.label || ''), left + width / 2, yBottom + (4 * scaleY));
  ctx.restore();
}

export function exportViewport({
  viewer,
  includeScaleBar = false,
  scaleBar = null,
  mime = 'image/png',
  filename,
}) {
  const source = viewerCanvas(viewer);
  if (!source) {
    return Promise.reject(new Error('查看器尚未就绪'));
  }
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return Promise.reject(new Error('无法创建导出画布'));
  }
  ctx.drawImage(source, 0, 0);
  if (includeScaleBar && scaleBar && scaleBar.label) {
    drawScaleBar(ctx, source, scaleBar);
  }
  const type = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法导出图像'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || snapshotFilename('slide', '', type);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, type, 0.92);
  });
}
