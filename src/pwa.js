// Установка как приложение, офлайн-кэш и обновления. Включается только в собранной версии (dist/).
(function () {
  if (!window.KANA_PWA) return;
  const $ = s => document.querySelector(s);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---- кнопка «Установить» ----
  let deferred = null;
  const btn = $('#btn-install');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  window.addEventListener('appinstalled', () => { btn.hidden = true; deferred = null; });
  if (isIOS && !standalone) btn.hidden = false;   // в Safari нет системного окна установки — покажем подсказку
  btn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) { } deferred = null; btn.hidden = true; }
    else $('#install-hint').hidden = false;
  });
  $('#install-hint-close').addEventListener('click', () => { $('#install-hint').hidden = true; });

  // ---- данные не должны удаляться системой при нехватке места ----
  if (standalone && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

  // ---- service worker и обновления ----
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  const bar = $('#update-bar');
  function offer(worker) {
    bar.hidden = false;
    $('#btn-update').onclick = () => { reloading = true; worker.postMessage('skip-waiting'); };
    $('#btn-update-later').onclick = () => { bar.hidden = true; };
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      // проверять новую версию, когда приложение снова открыли
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => { }); });
    } catch (e) { /* без офлайна сайт работает как обычно */ }
  });
})();
