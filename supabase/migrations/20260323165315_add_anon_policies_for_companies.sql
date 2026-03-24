/*
  # Add Anonymous User Policies for Social Media Manager

  1. Changes
    - Add policies to allow anonymous (anon role) users to manage companies and Twitter accounts
    - This enables the dashboard to work with the anon key without requiring authentication
  
  2. Security Note
    - These policies use the anon role which should be protected by your API key
    - Consider adding authentication if this dashboard becomes public-facing
*/

-- Add anon policies for companies table
CREATE POLICY "Anon users can view all companies"
  ON companies FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert companies"
  ON companies FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update companies"
  ON companies FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon users can delete companies"
  ON companies FOR DELETE
  TO anon
  USING (true);

-- Add anon policies for twitter_accounts table
CREATE POLICY "Anon users can view all twitter accounts"
  ON twitter_accounts FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can insert twitter accounts"
  ON twitter_accounts FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon users can update twitter accounts"
  ON twitter_accounts FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon users can delete twitter accounts"
  ON twitter_accounts FOR DELETE
  TO anon
  USING (true);
