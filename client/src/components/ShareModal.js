import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { X, Link2, Copy, Check, Share2, Trash2, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

// Load qrcodejs from CDN at runtime (no build-time dependency).
// If unavailable (offline / blocked), we gracefully degrade to link-only mode.
function loadQRCodeScript() {
  return new Promise((resolve) => {
    if (window.QRCode) return resolve(true);
    const existing = document.getElementById('qrcodejs-script');
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const s = document.createElement('script');
    s.id = 'qrcodejs-script';
    s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

export default function ShareModal({ slideId, onClose }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrReady, setQrReady] = useState(false);
  const qrRef = useRef(null);
  const qrDone = useRef(false);

  const refreshStatus = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/share/${slideId}`);
      setStatus(res.data);
    } catch (e) {
      toast.error('获取分享状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, [slideId]);

  const enableShare = async () => {
    try {
      const res = await axios.post(`/api/share/${slideId}`);
      setStatus({ shared: true, token: res.data.token, url: res.data.url });
      toast.success('分享已开启');
    } catch (e) {
      toast.error(e.response?.data?.error || '开启分享失败');
    }
  };

  const disableShare = async () => {
    try {
      await axios.delete(`/api/share/${slideId}`);
      setStatus({ shared: false, token: null, url: null });
      setQrReady(false);
      toast.success('分享已关闭');
    } catch (e) {
      toast.error('关闭分享失败');
    }
  };

  const copyLink = async () => {
    if (!status?.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('链接已复制');
    } catch (e) {
      toast.error('复制失败，请手动复制');
    }
  };

  // Render QR code once a share URL exists
  useEffect(() => {
    if (!status?.url) return;
    if (qrDone.current) return;
    qrDone.current = true;
    (async () => {
      const ok = await loadQRCodeScript();
      setQrReady(ok);
      if (ok && qrRef.current) {
        try {
          new window.QRCode(qrRef.current, {
            text: status.url,
            width: 160,
            height: 160,
            correctLevel: window.QRCode.CorrectLevel.M
          });
        } catch (e) {
          setQrReady(false);
        }
      }
    })();
  }, [status]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-600" /> 分享切片
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
              <Loader className="w-5 h-5 animate-spin" /> 加载中...
            </div>
          ) : !status?.shared ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Link2 className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-gray-600 mb-1">此切片尚未开启分享</p>
              <p className="text-sm text-gray-400 mb-6">开启后，任何有链接的人无需登录即可查看此切片</p>
              <button onClick={enableShare} className="btn-primary inline-flex items-center gap-2">
                <Share2 className="w-4 h-4" /> 开启分享
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                {/* QR code */}
                <div className="flex-shrink-0 flex flex-col items-center">
                  <div ref={qrRef} className="bg-white border border-gray-200 rounded-lg p-2 w-[178px] h-[178px] flex items-center justify-center">
                    {!qrReady && (
                      <span className="text-xs text-gray-400 text-center">二维码加载中<br />或不可用</span>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                  <div className="bg-blue-50 text-green-700 text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                    分享已开启
                  </div>
                  <p className="text-xs text-gray-500">任何拥有此链接的人无需登录即可查看该切片。</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={status.url}
                      className="input flex-1 text-xs text-gray-600"
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      onClick={copyLink}
                      className="btn-primary flex-shrink-0 inline-flex items-center gap-1 !px-3"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? '已复制' : '复制'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 flex justify-between items-center">
                <div className="text-xs text-gray-400">
                  提示：可通过微信/QQ 扫一扫二维码快速分享
                </div>
                <button
                  onClick={disableShare}
                  className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded"
                >
                  <Trash2 className="w-4 h-4" /> 关闭分享
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
