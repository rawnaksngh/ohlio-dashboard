/* Oli-Ohh live sync — pulls dashboard figures from Supabase and updates them the moment an admin publishes.
   Every number on a page carries data-live="<id>"; the Supabase key is "<page>|<id>".
   If Supabase can't be reached the page simply keeps the figures saved in the HTML. */
(function () {
  var CFG = window.OLI_SUPABASE || {
    url: 'https://xujgslalxvuddsjnyyfv.supabase.co',
    key: 'sb_publishable_wENzyo941znj0HeV9smINw_1RJQLNSt'
  };
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  function pageId(href) {
    var p = (href || location.pathname).split('?')[0].split('#')[0];
    p = decodeURIComponent(p.substring(p.lastIndexOf('/') + 1)) || 'index.html';
    return p.replace(/\.html?$/i, '');
  }
  var PAGE = pageId();

  function setText(el, v) {
    // Replace only the last text node so decorations inside the cell (bars, icons) survive.
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), last = null, n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim()) last = n;
    if (last) last.nodeValue = last.nodeValue.replace(/\S[\s\S]*\S|\S/, v);
    else el.appendChild(document.createTextNode(v));
  }
  function num(t) {
    var m = String(t == null ? '' : t).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  var fields = {};
  function index() {
    document.querySelectorAll('[data-live]').forEach(function (el) {
      var id = el.getAttribute('data-live');
      if (!fields[id]) fields[id] = { els: [], bars: [] };
      fields[id].els.push(el);
      if (el.__oliDefault === undefined) el.__oliDefault = el.textContent.trim();
    });
    document.querySelectorAll('[data-live-bar]').forEach(function (el) {
      var id = el.getAttribute('data-live-bar');
      if (!fields[id]) fields[id] = { els: [], bars: [] };
      fields[id].bars.push(el);
      if (el.__oliW === undefined) el.__oliW = parseFloat(el.style.width) || 0;
    });
  }

  function apply(id, value, flash) {
    var f = fields[id]; if (!f) return;
    f.els.forEach(function (el) {
      var v = value == null ? el.__oliDefault : String(value);
      if (el.textContent.trim() === v) return;
      setText(el, v);
      if (flash) { el.classList.remove('oli-live-flash'); void el.offsetWidth; el.classList.add('oli-live-flash'); }
    });
    // Bars keep the page's own scale: width moves in proportion to the value.
    var base = f.els.length ? num(f.els[0].__oliDefault) : NaN, now = num(value == null ? (f.els[0] || {}).__oliDefault : value);
    f.bars.forEach(function (b) {
      if (!isFinite(base) || !isFinite(now) || base === 0) return;
      b.style.width = Math.max(0, Math.min(100, b.__oliW * now / base)).toFixed(1) + '%';
    });
  }

  // ---------- status badge ----------
  var badge, latest = null;
  function css() {
    var s = document.createElement('style');
    s.textContent =
      '.oli-live-badge{position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;align-items:center;gap:7px;' +
      'padding:6px 11px;border-radius:999px;background:rgba(10,14,20,.78);color:#e6fffa;font:600 11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'letter-spacing:.3px;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:none}' +
      '.oli-live-dot{width:7px;height:7px;border-radius:50%;background:#7c8794}' +
      '.oli-live-badge.on .oli-live-dot{background:#00ffd5;box-shadow:0 0 0 0 rgba(0,255,213,.6);animation:oliPulse 2s infinite}' +
      '@keyframes oliPulse{0%{box-shadow:0 0 0 0 rgba(0,255,213,.55)}70%{box-shadow:0 0 0 7px rgba(0,255,213,0)}100%{box-shadow:0 0 0 0 rgba(0,255,213,0)}}' +
      '.oli-live-badge.sync .oli-live-dot,.oli-live-chip.sync .oli-live-dot{background:#ffb547;animation:oliSpin 1s linear infinite;border-radius:2px}' +
      '@keyframes oliSpin{to{transform:rotate(360deg)}}' +
      '.oli-live-chip{display:inline-flex;align-items:center;gap:8px;margin-top:8px;padding:5px 12px;border-radius:999px;' +
      'background:rgba(0,255,213,.08);border:1px solid rgba(0,255,213,.35);color:#bffff3;font:700 10.5px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:1.2px;text-transform:uppercase}' +
      '.oli-live-chip .oli-live-dot{width:8px;height:8px;border-radius:50%;background:#7c8794}' +
      '.oli-live-chip.on .oli-live-dot{background:#00ffd5;animation:oliPulse 2s infinite}' +
      '.oli-live-chip.sync{border-color:rgba(255,181,71,.5);color:#ffe2b3;background:rgba(255,181,71,.08)}' +
      '.oli-live-chip.off{border-color:rgba(255,255,255,.15);color:#9aa3ad;background:rgba(255,255,255,.04)}' +
      '.oli-live-chip .oli-live-sub{font-weight:600;letter-spacing:.4px;text-transform:none;opacity:.75}' +
      '.oli-live-flash{animation:oliFlash 1.6s ease}' +
      '@keyframes oliFlash{0%{background-color:rgba(0,255,213,.45)}100%{background-color:transparent}}' +
      '@media print{.oli-live-badge{display:none}}';
    document.head.appendChild(s);
  }
  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  // states: connecting → syncing → live (connected · synced hh:mm) ; offline when Supabase can't be reached
  var current = 'connecting', syncTimer = null, lastSync = null;
  function clock(d) { try { return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function status(state) {
    current = state;
    if (!badge) {
      badge = document.createElement('div'); badge.className = 'oli-live-badge';
      badge.innerHTML = '<span class="oli-live-dot"></span><span class="oli-live-txt"></span>';
      document.body.appendChild(badge);
    }
    var main = state === 'live' ? 'LIVE · CONNECTED' : state === 'syncing' ? 'SYNCING…' : state === 'connecting' ? 'CONNECTING…' : 'OFFLINE';
    var sub = state === 'live' ? (lastSync ? 'synced ' + clock(lastSync) : '') + (latest ? ' · data ' + fmtTime(latest) : '')
      : state === 'offline' ? 'showing saved figures' : '';
    badge.className = 'oli-live-badge' + (state === 'live' ? ' on' : state === 'syncing' ? ' sync' : '');
    badge.querySelector('.oli-live-txt').textContent = main + (state === 'live' && lastSync ? ' · synced ' + clock(lastSync) : state === 'offline' ? ' · saved figures' : '');
    document.querySelectorAll('[data-live-status]').forEach(function (chip) {
      chip.className = 'oli-live-chip' + (state === 'live' ? ' on' : state === 'syncing' || state === 'connecting' ? ' sync' : ' off');
      chip.innerHTML = '<span class="oli-live-dot"></span><span>' + main + '</span>' + (sub ? '<span class="oli-live-sub">' + sub.replace(/^ · /, '') + '</span>' : '');
    });
  }
  function synced() {
    lastSync = new Date();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { status('live'); }, 900);
  }
  function syncing() { status('syncing'); }
  function bump(ts) { if (ts && (!latest || ts > latest)) latest = ts; }

  // ---------- connect ----------
  function loadSdk(cb) {
    if (window.supabase && window.supabase.createClient) return cb();
    var s = document.createElement('script'); s.src = SDK; s.onload = cb; s.onerror = function () { status('offline'); };
    document.head.appendChild(s);
  }

  function start() {
    index();
    if (!Object.keys(fields).length) return;
    css(); status('connecting');
    loadSdk(function () {
      var client = window.__OLI_CLIENT || window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false } });
      var prefix = PAGE + '|';
      function pull() {
        syncing();
        return client.from('dashboard_values').select('field_key,value,updated_at').eq('page', PAGE).then(function (r) {
          if (r.error) { status('offline'); return; }
          (r.data || []).forEach(function (row) { apply(row.field_key.slice(prefix.length), row.value, false); bump(row.updated_at); });
          announce(); synced();
        }, function () { status('offline'); });
      }
      pull();
      // catch up after the tab was hidden or the network dropped
      document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(); });
      window.addEventListener('online', pull);
      client.channel('oli-live-' + PAGE)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_values', filter: 'page=eq.' + PAGE }, function (p) {
          var row = p.eventType === 'DELETE' ? p.old : p.new;
          if (!row || !row.field_key) return;
          syncing();
          apply(row.field_key.slice(prefix.length), p.eventType === 'DELETE' ? null : row.value, true);
          bump(p.eventType === 'DELETE' ? new Date().toISOString() : row.updated_at);
          announce(); synced();
        })
        .subscribe(function (s) {
          if (s === 'SUBSCRIBED') { if (current !== 'syncing') status('live'); }
          else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') status('offline');
        });
    });
  }

  var _an; function announce() { clearTimeout(_an); _an = setTimeout(function () { document.dispatchEvent(new CustomEvent('oli-live-update')); }, 50); }
  window.OliLive = { pageId: pageId, apply: apply, fields: fields };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
