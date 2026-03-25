/*
  # Add OAuth 1.0a Columns to Twitter Accounts

  OAuth 2.0 tokens (existing) are used for text-only tweets via v2 API.
  OAuth 1.0a tokens (new) are required for media uploads via v1.1 API.
  Both auth systems share the same app consumer key/secret, but need
  per-account access tokens.

  1. Changes
    - Add `oauth1_access_token` (text, nullable) to `twitter_accounts`
    - Add `oauth1_access_token_secret` (text, nullable) to `twitter_accounts`
*/

ALTER TABLE twitter_accounts
  ADD COLUMN IF NOT EXISTS oauth1_access_token text,
  ADD COLUMN IF NOT EXISTS oauth1_access_token_secret text;
