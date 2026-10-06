import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Home,
  Info,
  Maximize,
  Minimize,
  Minus,
  Plus,
} from 'lucide-react';

export default function ViewerChrome({
  title,
  subtitle,
  backTo = '/library',
  backLabel = '返回',
  magnifications,
  activeMag,
  onMagnification,
  readout,
  readoutHint,
  onZoomIn,
  onZoomOut,
  onHome,
  showInfo,
  onToggleInfo,
  filmstrip = [],
  info,
  scaleBar,
  loading,
  loadingText = '正在打开切片',
  loadingHint = 'Opening slide',
  error,
  children,
}) {
  const shellRef = React.useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    const node = shellRef.current;
    if (!node) return;
    if (!document.fullscreenElement) {
      node.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const bodyClass = [
    'viewer-body',
    filmstrip.length ? 'has-film' : '',
    showInfo ? 'has-info' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="viewer-shell" ref={shellRef}>
      <header className="viewer-top">
        <Link to={backTo} className="viewer-back" title={backLabel}>
          <ArrowLeft className="w-4 h-4" />
          <span className="sr-only">{backLabel}</span>
        </Link>
        <div className="viewer-title">
          <h1>{title || '未命名切片'}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        {magnifications?.length ? (
          <div className="mag-group" role="group" aria-label="放大倍率 Magnification">
            {magnifications.map((mag) => (
              <button
                key={mag}
                type="button"
                data-active={activeMag === mag}
                onClick={() => onMagnification?.(mag)}
              >
                {mag}×
              </button>
            ))}
          </div>
        ) : null}

        <div className="zoom-readout" aria-live="polite">
          <strong>{readout || '—'}</strong>
          {readoutHint ? <span>{readoutHint}</span> : null}
        </div>

        <div className="viewer-tools">
          <button type="button" onClick={onZoomOut} title="缩小 Zoom out">
            <Minus className="w-4 h-4" />
          </button>
          <button type="button" onClick={onHome} title="适应窗口 Fit">
            <Home className="w-4 h-4" />
          </button>
          <button type="button" onClick={onZoomIn} title="放大 Zoom in">
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-active={showInfo}
            onClick={onToggleInfo}
            title="切片信息 Info"
          >
            <Info className="w-4 h-4" />
          </button>
          <button type="button" onClick={toggleFullscreen} title="全屏 Fullscreen">
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className={bodyClass}>
        {filmstrip.length > 0 && (
          <aside className="filmstrip" aria-label="玻片列表">
            {filmstrip.map((item) => (
              <Link
                key={item.key}
                to={item.href}
                className={item.active ? 'is-active' : ''}
                title={item.name}
              >
                {item.src ? (
                  <img src={item.src} alt="" />
                ) : (
                  <span className="film-fallback">{item.name?.slice(0, 1) || '?'}</span>
                )}
              </Link>
            ))}
          </aside>
        )}

        <div className="stage">
          {children}
          {scaleBar && (
            <div
              className="scalebar"
              style={{ width: `${Math.max(48, Math.min(scaleBar.px, 280))}px` }}
              role="img"
              aria-label={scaleBar.label}
            >
              <i />
              <span>{scaleBar.label}</span>
            </div>
          )}
          {loading && !error && (
            <div className="stage-status">
              <div className="stage-spinner" />
              <p>{loadingText}</p>
              <p className="hint">{loadingHint}</p>
            </div>
          )}
          {error && (
            <div className="stage-status is-error">
              <p>无法打开这张切片</p>
              <p className="hint">{error}</p>
            </div>
          )}
        </div>

        {showInfo && (
          <aside className="meta-panel">
            <div className="meta-panel-head">
              <h2>切片信息</h2>
              <p>Slide details</p>
            </div>
            {info}
          </aside>
        )}
      </div>
    </div>
  );
}
