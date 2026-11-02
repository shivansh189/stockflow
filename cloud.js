/* StockFlow — Cloud Sync bridge (Supabase)
 *
 * One row per shop in the `stockflow_state` table holds the entire shop state
 * as JSON. Devices auto-pull on load, auto-push shortly after every save, and
 * receive real-time updates while open (if Realtime is enabled for the table).
 *
 * Config is stored in localStorage under key `stockflow_cloud_cfg_v1`
 * (url, key, shopCode). Anything here never contains secrets — the anon key
 * is public by design; a unique shop code keeps shops separated.
 */
'use strict';

(function () {
  const CFG_KEY = 'stockflow_cloud_cfg_v1';
  const TABLE = 'stockflow_state';

  let client = null;
  let cfg = null;
  let channel = null;
  let lastPushStamp = 0;

  function loadCfg() {
    if (!cfg) {
      try {
        const raw = localStorage.getItem(CFG_KEY);
        cfg = raw ? JSON.parse(raw) : null;
      } catch (e) { cfg = null; }
    }
    if (cfg && cfg.disabled) { client = null; return cfg; }
    if (!cfg && window.STOCKFLOW_CLOUD_DEFAULT && window.STOCKFLOW_CLOUD_DEFAULT.url) {
      cfg = window.STOCKFLOW_CLOUD_DEFAULT;
    }
    if (cfg && cfg.url && cfg.key && window.supabase) {
      client = window.supabase.createClient(cfg.url, cfg.key);
    } else { client = null; }
    return cfg;
  }

  function saveCfg(next) {
    cfg = next;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
    if (cfg && cfg.url && cfg.key && window.supabase) {
      client = window.supabase.createClient(cfg.url, cfg.key);
    }
  }

  function reset() {
    unsubscribe();
    client = null;
    saveCfg({ disabled: true });
  }

  function connected() {
    return !!(client && cfg && cfg.url && cfg.key && cfg.shopCode);
  }

  /* Quick check that the table exists and is reachable. */
  async function checkConnection() {
    if (!connected()) return { ok: false, reason: 'not-configured' };
    try {
      const { error } = await client.from(TABLE).select('updated_at').limit(1);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* Fetch the latest cloud state for this shop. Returns:
   *  { data, updatedAt } | { empty: true } | { error } | null (not connected) */
  async function pullLatest() {
    if (!connected()) return null;
    try {
      const { data, error } = await client
        .from(TABLE)
        .select('data, updated_at')
        .eq('shop_code', cfg.shopCode)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { empty: true };
      return { data: data.data, updatedAt: data.updated_at };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* Push the given full state object to the cloud row for this shop. */
  async function pushState(stateObj) {
    if (!connected()) return null;
    const now = new Date().toISOString();
    try {
      const payload = JSON.parse(JSON.stringify(stateObj || {}));
      const { error } = await client
        .from(TABLE)
        .upsert({ shop_code: cfg.shopCode, data: payload, updated_at: now }, { onConflict: 'shop_code' });
      if (error) return { error: error.message };
      lastPushStamp = now;
      return { ok: true, updatedAt: now };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* Real-time updates: fires cb(nextUpdatedSt, data) when another device changes the row. */
  function subscribe(onRemoteChange) {
    if (!connected() || !client) return null;
    try {
      channel = client
        .channel('stockflow-' + cfg.shopCode)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: TABLE, filter: 'shop_code=eq.' + cfg.shopCode },
          function (payload) {
            const newTs = payload && payload.new ? payload.new.updated_at : null;
            if (newTs && newTs <= lastPushStamp) return; // echo of our own push
            onRemoteChange(newTs, payload && payload.new ? payload.new.data : undefined);
          }
        )
        .subscribe();
      return channel;
    } catch (e) { return null; }
  }

  function unsubscribe() {
    if (channel && client && typeof channel.unsubscribe === 'function') {
      try { channel.unsubscribe(); } catch (e) {}
    }
    channel = null;
  }

  function getClient() { return client; }
  function getCfg() { return cfg; }

  /* The one-time SQL the user runs in the Supabase SQL editor once per project. */
  const SETUP_SQL = [
    'create table if not exists stockflow_state (',
    '  shop_code text primary key,',
    '  data jsonb not null default \'{}\'::jsonb,',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'alter table stockflow_state enable row level security;',
    'drop policy if exists "stockflow allow all" on stockflow_state;',
    'create policy "stockflow allow all" on stockflow_state for all using (true) with check (true);',
    '',
    '-- Realtime sync (ignore the error if it says the table is already in the publication):',
    'alter publication supabase_realtime add table stockflow_state;',
  ].join('\n');

  window.CloudSync = {
    loadCfg,
    saveCfg,
    reset,
    connected,
    checkConnection,
    pullLatest,
    pushState,
    subscribe,
    unsubscribe,
    getClient,
    getCfg,
    SETUP_SQL,
  };
})();
