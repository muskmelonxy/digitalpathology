import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import axios from 'axios';
import { FolderOpen, Microscope, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatMagnification, formatMpp, formatName, objectiveOf } from '../viewer/measure';
import { thumbnailUrl } from '../viewer/urls';

export default function Library() {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const { data, isLoading, error, refetch, isFetching } = useQuery(
    'wsi-library',
    () => axios.get('/api/wsi/slides?root=library').then((res) => res.data),
    { retry: false }
  );

  const slides = useMemo(() => {
    const rows = Array.isArray(data) ? data.filter((slide) => slide.root === 'library') : [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((slide) =>
      `${slide.name} ${slide.filename} ${slide.format || ''}`.toLowerCase().includes(needle)
    );
  }, [data, search]);

  const offline = error?.response?.status === 503;

  return (
    <div className="library-page">
      <header className="library-hero">
        <div>
          <p className="eyebrow">
            <Microscope className="w-4 h-4" />
            直接浏览 · Direct view
          </p>
          <h1>示例切片</h1>
          <p className="lede">
            把 <code>.kfb</code>、<code>.svs</code>、<code>.tif</code> 放进
            <code>slides/</code> 即可全分辨率查看。江丰切片由 kfbslide 直接读取，不必先转成 SVS 或 TIFF。
          </p>
        </div>
        <div className="library-tools">
          <div className="search-field">
            <Search className="w-4 h-4" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索切片 Search"
              aria-label="搜索切片"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="library-state">
          <div className="stage-spinner" />
          <p>正在读取示例切片…</p>
        </div>
      )}

      {offline && (
        <div className="callout">
          <h2>切片服务未启动</h2>
          <p>
            The tile service is not running. Start the app with <code>npm run dev</code>,
            or run <code>python -m tile_server</code> in the project virtualenv.
          </p>
        </div>
      )}

      {error && !offline && (
        <div className="callout is-error">
          <h2>无法连接切片服务</h2>
          <p>{error.response?.data?.error || error.message}</p>
        </div>
      )}

      {!isLoading && !error && slides.length === 0 && (
        <div className="library-state">
          <FolderOpen className="w-12 h-12" />
          <h2>{search ? '没有匹配的切片' : '示例切片是空的'}</h2>
          <p>
            {search
              ? '换一个关键词试试。'
              : '将切片文件放到项目根目录的 slides/ 文件夹，然后点刷新。'}
          </p>
        </div>
      )}

      {slides.length > 0 && (
        <div className="slide-grid">
          {slides.map((slide) => {
            const objective = objectiveOf(slide);
            const failed = Boolean(slide.error);
            const body = (
              <>
                <div className="thumb">
                  {!failed && (
                    <img
                      src={thumbnailUrl(slide.root, slide.filename, token)}
                      alt=""
                    />
                  )}
                  <span className={`format-chip format-${formatName(slide.format).toLowerCase()}`}>
                    {formatName(slide.format)}
                  </span>
                </div>
                <div className="slide-card-body">
                  <h2>{slide.name}</h2>
                  {failed ? (
                    <p className="slide-error">{slide.error}</p>
                  ) : (
                    <>
                      <p>
                        {slide.width?.toLocaleString()} × {slide.height?.toLocaleString()} px
                      </p>
                      <p>
                        {objective ? formatMagnification(objective) : '倍率未知'}
                        <span> · </span>
                        {formatMpp(slide.mpp_x)}
                        <span> · </span>
                        {slide.level_count || '—'} 层
                      </p>
                    </>
                  )}
                </div>
              </>
            );
            if (failed) {
              return (
                <article key={slide.id} className="slide-card is-error">
                  {body}
                </article>
              );
            }
            return (
              <Link
                key={slide.id}
                to={`/library/${encodeURIComponent(slide.filename)}`}
                className="slide-card"
              >
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
