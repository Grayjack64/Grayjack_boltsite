/**
 * Twitter API Client for Grayjack Social Media Automation
 *
 * Use this module to programmatically post tweets for any connected company.
 * Perfect for automated blog posting, scheduled content, and other automation.
 */

const SUPABASE_URL = 'https://edkisozjywgkgqczglbm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVka2lzb3pqeXdna2dxY3pnbGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODA1NDEsImV4cCI6MjA4OTg1NjU0MX0.zp0aytJNgaKKndLeUgqkMw6aikSc-5FHvRsbjf9CWt8';

class TwitterAPIClient {
  constructor() {
    this.baseUrl = `${SUPABASE_URL}/functions/v1/twitter-oauth`;
    this.headers = {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Post a tweet for a specific company
   * @param {string} companyId - The UUID of the company
   * @param {string} text - The tweet text (max 280 characters)
   * @param {Object} [options] - Optional parameters
   * @param {File[]|Blob[]} [options.media] - Media files to attach (up to 4 images or 1 video)
   * @returns {Promise<{success: boolean, tweet_id?: string, text?: string, error?: string}>}
   */
  async postTweet(companyId, text, options = {}) {
    try {
      if (!companyId || !text) {
        throw new Error('companyId and text are required');
      }

      if (text.length > 280) {
        throw new Error('Tweet text must be 280 characters or less');
      }

      const mediaFiles = options.media || [];

      if (mediaFiles.length > 4) {
        throw new Error('Maximum 4 media files per tweet');
      }

      let response;

      if (mediaFiles.length > 0) {
        const formData = new FormData();
        formData.append('company_id', companyId);
        formData.append('text', text);
        for (const file of mediaFiles) {
          formData.append('media', file);
        }
        response = await fetch(`${this.baseUrl}/post`, {
          method: 'POST',
          headers: {
            'Authorization': this.headers['Authorization'],
          },
          body: formData,
        });
      } else {
        response = await fetch(`${this.baseUrl}/post`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({
            company_id: companyId,
            text: text
          })
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to post tweet');
      }

      return {
        success: true,
        tweet_id: data.tweet_id,
        text: data.text
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Post a tweet for a company by slug (URL-safe identifier)
   * @param {string} companySlug - The slug of the company (e.g., 'company-name')
   * @param {string} text - The tweet text (max 280 characters)
   * @param {Object} [options] - Optional parameters
   * @param {File[]|Blob[]} [options.media] - Media files to attach (up to 4 images or 1 video)
   * @returns {Promise<{success: boolean, tweet_id?: string, text?: string, error?: string}>}
   */
  async postTweetBySlug(companySlug, text, options = {}) {
    try {
      const companyId = await this.getCompanyIdBySlug(companySlug);
      if (!companyId) {
        throw new Error(`Company with slug '${companySlug}' not found`);
      }
      return await this.postTweet(companyId, text, options);
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all companies
   * @returns {Promise<Array<{id: string, name: string, slug: string, twitter_connected: boolean}>>}
   */
  async getCompanies() {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=*,twitter_accounts(*)`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      const companies = await response.json();

      return companies.map(company => ({
        id: company.id,
        name: company.name,
        slug: company.slug,
        twitter_connected: company.twitter_accounts && company.twitter_accounts.length > 0,
        twitter_username: company.twitter_accounts?.[0]?.username || null
      }));
    } catch (error) {
      console.error('Error fetching companies:', error);
      return [];
    }
  }

  /**
   * Get company ID by slug
   * @param {string} slug - The company slug
   * @returns {Promise<string|null>}
   */
  async getCompanyIdBySlug(slug) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/companies?slug=eq.${slug}&select=id`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      const companies = await response.json();
      return companies.length > 0 ? companies[0].id : null;
    } catch (error) {
      console.error('Error fetching company:', error);
      return null;
    }
  }

  /**
   * Check if a company has Twitter connected
   * @param {string} companyId - The UUID of the company
   * @returns {Promise<boolean>}
   */
  async isTwitterConnected(companyId) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/twitter_accounts?company_id=eq.${companyId}&is_active=eq.true&select=id`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      const accounts = await response.json();
      return accounts.length > 0;
    } catch (error) {
      console.error('Error checking Twitter connection:', error);
      return false;
    }
  }
}

export default TwitterAPIClient;

export { TwitterAPIClient };
