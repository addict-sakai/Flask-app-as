/**
 * app_qr_scan.js  –  QRコードスキャン モジュール
 * Mt.FUJI PARAGLIDING / FujipSystem
 * 作成: 2026-03-26
 *
 * 依存: jsQR.js（app/static/jsQR.js として配置）
 *
 * 使い方:
 *   QRScanner.open(onDetected)  // onDetected(uuid) が検出時に呼ばれる
 *   QRScanner.close()           // 強制クローズ
 */

const QRScanner = (() => {

  let _stream      = null;   // MediaStream
  let _animFrameId = null;   // requestAnimationFrame ID
  let _scanning    = false;  // 重複処理防止フラグ
  let _onDetected  = null;   // 検出コールバック

  /* ─── モーダルを開いてカメラ起動 ─── */
  async function open(onDetected) {
    _onDetected = onDetected || null;

    const overlay = document.getElementById('qrscan-overlay');
    if (!overlay) { console.error('[QRScanner] #qrscan-overlay が見つかりません'); return; }

    overlay.classList.add('is-visible');
    document.body.style.overflow = 'hidden';
    _scanning = false;
    _setStatus('カメラを起動しています…', '');

    // jsQR の読み込み確認
    if (typeof jsQR === 'undefined') {
      _setStatus('QRライブラリが読み込まれていません。ページを再読み込みしてください。', 'error');
      return;
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });

      const video = document.getElementById('qrscan-video');
      video.srcObject = _stream;
      await new Promise((resolve, reject) => {
        video.oncanplay = resolve;
        video.onerror   = reject;
        video.play().catch(reject);
      });

      _setStatus('QRコードをスキャン枠内に合わせてください', '');
      _startScan();

    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'カメラへのアクセスが拒否されました。ブラウザの設定をご確認ください。'
        : 'カメラを起動できませんでした：' + err.message;
      _setStatus(msg, 'error');
      console.error('[QRScanner] camera error:', err);
    }
  }

  /* ─── フレーム解析（jsQR） ─── */
  function _startScan() {
    const video  = document.getElementById('qrscan-video');
    // HTMLに存在するcanvasを使用（offscreen canvasは一部環境でgetImageDataがブロックされる）
    const canvas = document.getElementById('qrscan-canvas');
    const ctx    = canvas.getContext('2d', { willReadFrequently: true });

    function tick() {
      if (video.readyState >= 2 && !_scanning) {
        const vw = video.videoWidth  || 640;
        const vh = video.videoHeight || 480;

        // 映像全体を400px以内に縮小
        const scale   = Math.min(1, 400 / Math.max(vw, vh));
        canvas.width  = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);

        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            console.log('[QRScanner] 検出:', code.data);
            _scanning = true;
            _onCodeDetected(code.data);
            return;
          }
        } catch(e) {
          console.warn('[QRScanner] canvas描画エラー:', e.message);
        }
      }
      _animFrameId = requestAnimationFrame(tick);
    }
    _animFrameId = requestAnimationFrame(tick);
  }

  /* ─── QRコード検出時 ─── */
  async function _onCodeDetected(rawValue) {
    // スキャン成功フラッシュ
    const wrap = document.getElementById('qrscan-video-wrap');
    if (wrap) {
      wrap.classList.add('scan-ok');
      setTimeout(() => wrap.classList.remove('scan-ok'), 400);
    }

    _setStatus('<span class="qrscan-spinner"></span>会員情報を取得中…', '');

    // UUID を抽出
    // パターン①: URL末尾  例: https://xxx/api/members/by-uuid/xxxxxxxx-xxxx-...
    // パターン②: UUID単体  例: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = rawValue.match(uuidPattern);

    if (!match) {
      _setStatus('このQRコードは対応していません', 'error');
      setTimeout(() => {
        _scanning = false;
        _setStatus('QRコードをスキャン枠内に合わせてください', '');
        _startScan();
      }, 2000);
      return;
    }

    const uuid = match[0];

    // /api/io/lookup で会員情報を取得
    let data;
    try {
      const resp = await fetch('/api/io/lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: uuid }),
      });
      data = await resp.json();
      if (!resp.ok) {
        _setStatus(data.error || '会員が見つかりません', 'error');
        setTimeout(() => { _scanning = false; _startScan(); }, 2000);
        return;
      }
    } catch {
      _setStatus('通信エラーが発生しました', 'error');
      setTimeout(() => { _scanning = false; _startScan(); }, 2000);
      return;
    }

    _setStatus('✓ ' + data.full_name + ' さんを確認しました', 'ok');

    // 600ms後にカメラを止めて、コールバックへ渡す
    setTimeout(() => {
      close();
      if (typeof _onDetected === 'function') _onDetected(data);
    }, 600);
  }

  /* ─── ステータス表示 ─── */
  function _setStatus(html, type) {
    const el = document.getElementById('qrscan-status');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'qrscan-status' + (type ? ' ' + type : '');
  }

  /* ─── カメラ停止・リソース解放 ─── */
  function _stopCamera() {
    if (_animFrameId) {
      cancelAnimationFrame(_animFrameId);
      _animFrameId = null;
    }
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
    const video = document.getElementById('qrscan-video');
    if (video) video.srcObject = null;
    _scanning = false;
  }

  /* ─── モーダルを閉じる（オーバーレイクリック用） ─── */
  function closeOnOverlay(event) {
    if (event.target === document.getElementById('qrscan-overlay')) close();
  }

  /* ─── モーダルを強制クローズ ─── */
  function close() {
    _stopCamera();
    const overlay = document.getElementById('qrscan-overlay');
    if (overlay) overlay.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

  /* ─── 公開インターフェース ─── */
  return { open, close, closeOnOverlay };

})();
