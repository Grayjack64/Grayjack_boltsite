/*
  # Add OAuth State Table

  1. New Tables
    - `oauth_states`
      - `id` (uuid, primary key)
      - `company_id` (uuid, references companies)
      - `state` (text, unique) - The state parameter sent to OAuth provider
      - `code_verifier` (text) - PKCE code verifier for token exchange
      - `redirect_uri` (text) - The redirect URI for this OAuth flow
      - `platform` (text) - Which platform (twitter, facebook, instagram)
      - `expires_at` (timestamptz) - When this state expires (5 minutes)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `oauth_states` table
    - Add policy for service role only (this is internal to edge functions)
*/

CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  state text UNIQUE NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  platform text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (edge functions)
CREATE POLICY "Service role can manage oauth states"
  ON oauth_states
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
