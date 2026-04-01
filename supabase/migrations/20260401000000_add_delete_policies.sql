-- Allow authenticated users to delete twitter and meta accounts (for disconnect button)
CREATE POLICY "Authenticated users can delete twitter accounts"
  ON twitter_accounts FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete meta accounts"
  ON meta_accounts FOR DELETE TO authenticated USING (true);
