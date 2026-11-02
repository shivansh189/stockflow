/* StockFlow — default cloud sync (account) configuration.
 *
 * These values are baked in so every device that opens the app signs in
 * against the same cloud project. Each user's data is stored privately under
 * their own logged-in account (Supabase auth + Row Level Security).
 */
'use strict';

window.STOCKFLOW_CLOUD_DEFAULT = {
  // Supabase project REST URL
  url: 'https://xbakjftgofcftcgpsisx.supabase.co',
  // Supabase publishable key — public by design; RLS keeps each account's
  // data private to that account.
  key: 'sb_publishable_JVGvLql0BtsqF4n6aaXFkQ_D-Mm70ec',
};
