/* StockFlow — Cloud Sync / Account (Supabase)
 *
 * Simple flow: user signs in with their email (e.g. Gmail) using a one-time
 * code. Everything they save auto-pushed to their own cloud row — data stays
 * private per account (Row Level Security scopes it by auth.uid()).
 *
 *   sign in with email  ->  client.auth.signInWithOtp({ email })
 *   verify 6-digit code ->  client.auth.verifyOtp({ email, token, type: 'email' })
 *   session persists in localStorage; every save queues a push; devices get
 *   real-time updates via postgres_changes (RLS-scoped).
 */
'use strict';

(function () {
  const CFG_KEY = 'stockflow_cloud_cfg_v1';
  const TABLE = 'stockflow_state';

  let client = null;
  let channel = null;
  let lastPushStamp = 0;

  function loadCfg() {
    if (client) return client; // already built
    const raw = (window.STOCKFLOW_CLOUD_DEFAULT && window.STOCKFLOW_CLOUD_DEFAULT.url) ? window.STOCKFLOW_CLOUD_DEFAULT : null;
    try {
      const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (window.supabase && saved && saved.url && saved.key) {
        client = window.supabase.createClient(saved.url, saved.key);
        return client;
      }
    } catch (e) { /* fall through to defaults */ }
    if (window.supabase && raw && raw.url && raw.key) {
      client = window.supabase.createClient(raw.url, raw.key);
    }
    return client;
  }

  function isAvailable() { return !!loadCfg(); }

  /* -------- auth -------- */

  async function sendLoginCode(email) {
    if (!isAvailable()) return { error: 'cloud not configured' };
    try {
      const { error } = await client.auth.signInWithOtp({ email: email.trim().toLowerCase(), shouldCreateUser: true });
      return error ? { error: error.message } : { ok: true };
    } catch (e) { return { error: e.message }; }
  }

  async function verifyLoginCode(email, token) {
    if (!isAvailable()) return { error: 'cloud not configured' };
    try {
      const { error } = await client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
      return error ? { error: error.message } : { ok: true };
    } catch (e) { return { error: e.message }; }
  }

  /* Redirect the browser to Google sign-in. On return, onAuth fires and the
   * caller lifts the login gate. */
  function loginWithGoogle() {
    if (!isAvailable()) return Promise.resolve({ error: 'cloud not configured' });
    const redirectTo = window.location.origin + window.location.pathname;
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo },
    }).then(function (r) { return r && r.error ? { error: r.error.message } : { ok: true }; })
      .catch(function (e) { return { error: e.message }; });
  }

  async function signOut() {
    if (!isAvailable()) return;
    unsubscribe();
    try { await client.auth.signOut(); } catch (e) {}
    lastPushStamp = 0;
  }

  async function getSession() {
    if (!isAvailable()) return null;
    try {
      const { data } = await client.auth.getSession();
      return data && data.session ? data.session : null;
    } catch (e) { return null; }
  }

  function onAuth(cb) {
    if (!isAvailable()) return function () {};
    const { data } = client.auth.onAuthStateChange(function () { cb(); });
    return function () { data.subscription.unsubscribe(); };
  }

  /* -------- row sync (per user) -------- */

  /* Fetch the account's cloud state:
   *  { data, updatedAt } | { empty: true } | { error } | { signedOut: true } */
  async function pullLatest() {
    const s = await getSession();
    if (!s) return { signedOut: true, isAvailable: isAvailable() };
    try {
      const { data, error } = await client
        .from(TABLE)
        .select('data, updated_at')
        .eq('user_id', s.user.id)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { empty: true };
      return { data: data.data, updatedAt: data.updated_at };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* Push the given state to the signed-in account's cloud row. */
  async function pushState(stateObj) {
    const s = await getSession();
    if (!s) return null;
    const now = new Date().toISOString();
    try {
      const payload = JSON.parse(JSON.stringify(stateObj || {}));
      const { error } = await client
        .from(TABLE)
        .upsert({ user_id: s.user.id, data: payload, updated_at: now }, { onConflict: 'user_id' });
      if (error) return { error: error.message };
      lastPushStamp = now;
      return { ok: true, updatedAt: now };
    } catch (e) { return { error: e.message }; }
  }

  /* Real-time events when another device pushes (RLS keeps it private). */
  function subscribe(onRemoteChange, onSignedOutChange) {
    if (!isAvailable() || !client) return null;
    unsubscribe();
    getSession().then(function (s) {
      if (!s) return;
      try {
        channel = client
          .channel('stockflow-user-' + s.user.id)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + s.user.id },
            function (payload) {
              const newTs = payload && payload.new ? payload.new.updated_at : null;
              if (newTs && newTs <= lastPushStamp) return;
              onRemoteChange(newTs, payload && payload.new ? payload.new.data : undefined);
            }
          )
          .subscribe();
      } catch (e) { /* realtime best-effort */ }
    });
    return channel;
  }

  function unsubscribe() {
    if (channel && client && typeof channel.unsubscribe === 'function') {
      try { channel.unsubscribe(); } catch (e) {}
    }
    channel = null;
  }

  window.CloudSync = {
    loadCfg,
    isAvailable,
    loginWithGoogle,
    sendLoginCode,
    verifyLoginCode,
    signOut,
    getSession,
    onAuth,
    pullLatest,
    pushState,
    subscribe,
    unsubscribe,
    getCfg: function () { const d = window.STOCKFLOW_CLOUD_DEFAULT || {}; return { url: d.url || '' }; },
    REALTIME_TABLE: TABLE,
  };
})();
