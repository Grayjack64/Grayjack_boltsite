/*
  # Add Anonymous User Policies for OAuth States

  1. Changes
    - Add policies to allow anonymous (anon role) users to delete oauth_states
    - This enables the reconnect functionality to clean up old state entries

  2. Security Note
    - These policies use the anon role which should be protected by your API key
    - Deletion is important to prevent stale OAuth state entries from accumulating
*/

-- Add anon policies for oauth_states table
CREATE POLICY "Anon users can delete oauth states"
  ON oauth_states FOR DELETE
  TO anon
  USING (true);