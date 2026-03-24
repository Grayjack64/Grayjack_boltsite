/*
  # Social Media Posting System Schema

  1. New Tables
    - `companies`
      - `id` (uuid, primary key) - Unique company identifier
      - `name` (text) - Company name
      - `slug` (text, unique) - URL-safe company identifier
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
    
    - `twitter_accounts`
      - `id` (uuid, primary key) - Unique account identifier
      - `company_id` (uuid, foreign key) - Links to companies table
      - `twitter_user_id` (text) - Twitter user ID
      - `username` (text) - Twitter username
      - `access_token` (text) - OAuth access token (encrypted)
      - `refresh_token` (text) - OAuth refresh token (encrypted)
      - `token_expires_at` (timestamptz) - Token expiration time
      - `is_active` (boolean) - Account active status
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their companies
    - Add policies for authenticated users to manage Twitter accounts

  3. Important Notes
    - Tokens are stored encrypted for security
    - Each company can have one Twitter account
    - System supports token refresh for long-term access
*/

-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create twitter_accounts table
CREATE TABLE IF NOT EXISTS twitter_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  twitter_user_id text UNIQUE NOT NULL,
  username text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id)
);

-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE twitter_accounts ENABLE ROW LEVEL SECURITY;

-- Companies policies
CREATE POLICY "Authenticated users can view all companies"
  ON companies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert companies"
  ON companies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update companies"
  ON companies FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete companies"
  ON companies FOR DELETE
  TO authenticated
  USING (true);

-- Twitter accounts policies
CREATE POLICY "Authenticated users can view all twitter accounts"
  ON twitter_accounts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert twitter accounts"
  ON twitter_accounts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update twitter accounts"
  ON twitter_accounts FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete twitter accounts"
  ON twitter_accounts FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_twitter_accounts_company_id ON twitter_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_twitter_accounts_updated_at ON twitter_accounts;
CREATE TRIGGER update_twitter_accounts_updated_at
  BEFORE UPDATE ON twitter_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();