/* Sync settings. Paste your two Supabase values here (Project Settings -> API).
 * Both are safe to publish: the anon key only works with the row-level security rules from supabase/schema.sql.
 * Leave them empty to run in local-only mode (no account, no syncing). */
window.PT_CONFIG = {
  SUPABASE_URL: 'https://lcyrliagjclvpfikeaxe.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjeXJsaWFnamNsdnBmaWtlYXhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NjkxMDUsImV4cCI6MjEwODQ0NTEwNX0.3KYKuNYaSt2C0KlowtTDyvQnejDEx-7SaezRfXTxhqA',
  // Usernames are turned into private pseudo-emails on this domain (no email is ever sent). Leave as is.
  EMAIL_DOMAIN: 'gmail.com'
};
