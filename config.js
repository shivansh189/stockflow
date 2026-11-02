/* StockFlow — default cloud sync configuration.
 *
 * These values are baked in so every device that opens the app connects to
 * the same shared inventory automatically.
 *
 * To run a *separate* shop: open the app's ☁️ Sync / Cloud page and save a
 * different configuration — a per-device config in localStorage always
 * overrides these defaults (even offline).
 */
'use strict';

window.STOCKFLOW_CLOUD_DEFAULT = {
  // Supabase project REST URL
  url: 'https://xbakjftgofcftcgpsisx.supabase.co',
  // Supabase publishable (anon) key — public by design; RLS + the shop code
  // keep this app's data scoped.
  key: 'sb_publishable_JVGvLql0BtsqF4n6aaXFkQ_D-Mm70ec',
  // Shop code — devices using the same code share one inventory.
  shopCode: 'SF-SHIV-01',
};
