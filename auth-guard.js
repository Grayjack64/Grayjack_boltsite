/**
 * Auth guard for Grayjack dashboard pages.
 * Include this script at the top of any protected page.
 * Requires @supabase/supabase-js UMD to be loaded first.
 */
(function() {
  const SUPABASE_URL = 'https://edkisozjywgkgqczglbm.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVka2lzb3pqeXdna2dxY3pnbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODA1NDEsImV4cCI6MjA4OTg1NjU0MX0.zp0aytJNgaKKndLeUgqkMw6aikSc-5FHvRsbjf9CWt8';

  window.__supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Hide page content until auth is verified
  document.documentElement.style.visibility = 'hidden';

  window.__supabaseClient.auth.getSession().then(function(result) {
    var session = result.data.session;
    if (!session) {
      var currentPath = window.location.pathname;
      window.location.href = '/login.html?redirect=' + encodeURIComponent(currentPath);
      return;
    }

    // Auth verified — show page
    document.documentElement.style.visibility = 'visible';

    // Make session available globally
    window.__authSession = session;
    window.__authUser = session.user;

    // Dispatch event for pages that need to know auth is ready
    window.dispatchEvent(new Event('authReady'));
  });

  // Logout helper
  window.logout = async function() {
    await window.__supabaseClient.auth.signOut();
    window.location.href = '/login.html';
  };
})();
