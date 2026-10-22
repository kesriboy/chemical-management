/* ===========================================================
   cloud.js — 云端实时同步层
   ------------------------------------------------------------
   设计：
   - 单一文档模型：云端 chem_kv 表中只有一行 id='main'，
     其 data 列存放整个应用状态（chemicals / records / meta）。
   - 任意一端改动 → commit 时把本地快照 upsert 到云端（防抖 800ms）。
   - 轮询（默认 10s）只比对 updated_at：发现云端时间戳变化即拉取
     最新文档并回调，实现「数据时时更新」。
   - 全程不做逐字段合并，整文档 last-write-wins（单人多端场景足够）。
   - 配置仅含 publicConfig 中可公开字段，无任何密钥。
   =========================================================== */
(function (global) {
  'use strict';

  // 来自 cloud-service 激活后的 publicConfig（仅可公开字段，无密钥）
  var CLOUD = {
    endpoint: 'https://chem-mgmt.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_1UK1uaxqzOzXq6W5MNGXOo_7hOJeZ33VNiUFF0N98t2VMxtdUNHN639'
  };
  var TABLE = 'chem_kv';
  var DOC_ID = 'main';
  var PUSH_DELAY = 800;
  var POLL_MS = 10000;

  var cloud = null;
  var ready = false;
  var lastTs = null;        // 最近一次已知的云端 updated_at（原始字符串）
  var pushTimer = null;
  var pollTimer = null;
  var remoteCbs = [];
  var statusCb = null;

  function setStatus(ok, text) {
    if (statusCb) { try { statusCb(ok, text); } catch (e) {} }
  }

  // 把错误对象压成短串，便于在徽标上一眼看出是 CORS/401/42501/网络哪类问题
  function shortErr(e) {
    if (!e) return '';
    var m = e.message || e.code || e.error_description || (typeof e === 'string' ? e : '');
    if (!m) { try { m = JSON.stringify(e); } catch (_) { m = String(e); } }
    m = String(m).replace(/\s+/g, ' ').trim();
    return m.length > 40 ? m.slice(0, 40) + '…' : m;
  }
  function reportErr(where, e) {
    console.warn('[cloud] ' + where + ' error', e);
    try { window.__cloudLastError = { where: where, error: e }; } catch (_) {}
    return shortErr(e);
  }

  // 两个时间戳可能格式不同（如 2026-...Z vs 2026-...+00），统一按 epoch 比较
  function tsEqual(a, b) {
    if (!a || !b) return false;
    var ta = Date.parse(a), tb = Date.parse(b);
    return !isNaN(ta) && !isNaN(tb) && ta === tb;
  }

  function init(opts) {
    opts = opts || {};
    statusCb = opts.onStatus || null;
    if (typeof global.WorkBuddyCloud === 'undefined') {
      setStatus(false, '云同步未加载');
      return false;
    }
    try {
      cloud = global.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: CLOUD.endpoint,
        oauthRelayBaseUrl: CLOUD.oauthRelayBaseUrl,
        publishableKey: CLOUD.publishableKey
      });
      ready = true;
      setStatus(true, '云同步已连接');
      return true;
    } catch (e) {
      console.error('[cloud] init failed', e);
      setStatus(false, '云同步初始化失败');
      return false;
    }
  }

  function pull() {
    if (!ready) return Promise.resolve(null);
    return cloud.database.from(TABLE)
      .select('data, updated_at').eq('id', DOC_ID).maybeSingle()
      .then(function (res) {
        if (res.error) { setStatus(false, '云读取失败 ' + reportErr('pull', res.error)); return null; }
        if (!res.data) return null;
        lastTs = res.data.updated_at;
        return res.data.data;
      })
      .catch(function (e) { setStatus(false, '云读取失败 ' + reportErr('pull', e)); return null; });
  }

  function push(stateObj) {
    if (!ready) return Promise.resolve(false);
    return cloud.database.from(TABLE).upsert({
      id: DOC_ID,
      data: stateObj,
      updated_at: new Date().toISOString()
    }).select().then(function (res) {
      if (res.error) { setStatus(false, '云写入失败 ' + reportErr('push', res.error)); return false; }
      if (res.data && res.data[0]) lastTs = res.data[0].updated_at;
      setStatus(true, '云同步已连接');
      return true;
    }).catch(function (e) { setStatus(false, '云写入失败 ' + reportErr('push', e)); return false; });
  }

  function schedulePush(getState) {
    if (!ready) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push(getState()); }, PUSH_DELAY);
  }

  function startPolling() {
    if (!ready) return;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      cloud.database.from(TABLE).select('updated_at').eq('id', DOC_ID).maybeSingle()
        .then(function (res) {
          if (res.error || !res.data) return;
          if (!tsEqual(res.data.updated_at, lastTs)) {
            pull().then(function (data) {
              if (data) remoteCbs.forEach(function (fn) { try { fn(data); } catch (e) {} });
            });
          }
        }).catch(function () {});
    }, POLL_MS);
  }

  function onRemoteUpdate(fn) { remoteCbs.push(fn); }

  global.CloudSync = {
    init: init,
    pull: pull,
    push: push,
    schedulePush: schedulePush,
    startPolling: startPolling,
    onRemoteUpdate: onRemoteUpdate,
    get ready() { return ready; }
  };
})(window);
