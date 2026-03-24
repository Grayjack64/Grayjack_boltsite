# Twitter Authorization Guide

## How Authorization Works

Yes, each company's Twitter account must authorize your app to post on their behalf. This is a one-time setup process per company.

## Authorization Flow

### Step 1: Admin Opens Dashboard
Go to your dashboard at `https://grayjackholdings.com/dashboard.html`

### Step 2: Add Company
1. Click the "Add Company" card
2. Enter company name (e.g., "Grayjack Holdings")
3. Company slug is auto-generated (e.g., "grayjack-holdings")
4. Click "Add Company"

### Step 3: Connect Twitter Account
1. In the "Connected Accounts" section, find the company you just added
2. Click the "Connect Twitter" button next to the company
3. You'll be redirected to Twitter's authorization page

### Step 4: Twitter Authorization
On Twitter's page, the account owner will:
1. Log in to Twitter (if not already logged in)
2. Review the permissions being requested:
   - Read tweets
   - Write tweets
   - View profile information
3. Click "Authorize app"
4. Be redirected back to your callback page

### Step 5: Success
- The Twitter account is now connected
- Your automation scripts can post to this account
- The dashboard shows "Connected" with the Twitter username

## Who Needs to Authorize?

The person who clicks "Connect Twitter" must:
- Have login credentials for the Twitter account
- Have authorization to connect third-party apps
- Be logged into Twitter (or willing to log in during the flow)

## What Permissions Are Requested?

The app requests these Twitter API scopes:
- `tweet.read` - Read tweets
- `tweet.write` - Create tweets
- `users.read` - Read user profile information
- `offline.access` - Maintain access without re-authentication

## Security Features

1. **OAuth 2.0**: Industry-standard authorization protocol
2. **State Parameter**: Prevents CSRF attacks
3. **Secure Token Storage**: Access tokens stored encrypted in Supabase
4. **Token Refresh**: Automatic token renewal when expired
5. **Revocable Access**: Users can revoke access anytime from Twitter settings

## Re-Authorization

You may need to re-authorize if:
- The user revokes access from Twitter settings
- Tokens expire and refresh fails
- The Twitter app credentials change

Simply click "Connect Twitter" again to re-authorize.

## For Multiple Companies

Each company needs its own authorization:

1. **Grayjack Holdings** Twitter account → Authorize once
2. **Grayjack Marketing** Twitter account → Authorize once
3. **Grayjack Tech** Twitter account → Authorize once

After authorization, all companies can be automated programmatically.

## Checking Authorization Status

### Via Dashboard
Visit `dashboard.html` - shows "Connected" or "Not Connected" for each company

### Via API
```javascript
import TwitterAPIClient from './twitter-api-client.js';

const twitter = new TwitterAPIClient();
const companies = await twitter.getCompanies();

companies.forEach(company => {
  console.log(`${company.name}: ${company.twitter_connected ? 'Connected' : 'Not Connected'}`);
});
```

### Via Direct Query
```javascript
const response = await fetch(
  'https://edkisozjywgkgqczglbm.supabase.co/rest/v1/twitter_accounts?select=*',
  {
    headers: {
      'apikey': 'YOUR_SUPABASE_ANON_KEY',
      'Authorization': 'Bearer YOUR_SUPABASE_ANON_KEY'
    }
  }
);

const accounts = await response.json();
console.log(`${accounts.length} accounts connected`);
```

## Troubleshooting

### "Failed to connect to Twitter"
- Check that Twitter app credentials are set in Supabase Edge Function secrets
- Verify the redirect URI matches: `https://grayjackholdings.com/callback-twitter.html`
- Ensure Twitter Developer account is active

### "No active Twitter account found for this company"
- The company hasn't completed authorization
- Go to dashboard and click "Connect Twitter"

### "Token expired"
- Tokens automatically refresh
- If refresh fails, re-authorize by clicking "Connect Twitter" again

### "Failed to post tweet"
- Check Twitter API rate limits
- Verify account still has posting permissions
- Ensure tweet text is within 280 characters

## Direct Authorization URL

For advanced users, you can construct the authorization URL directly:

```javascript
const companyId = 'your-company-uuid';
const authUrl = `https://edkisozjywgkgqczglbm.supabase.co/functions/v1/twitter-oauth/authorize?company_id=${companyId}`;

// Redirect user to this URL
window.location.href = authUrl;
```

## Revoking Access

Users can revoke access at any time:

1. Go to Twitter Settings → Security and account access
2. Click "Apps and sessions"
3. Find your app name
4. Click "Revoke access"

To reconnect, simply go through the authorization flow again.

## Summary

1. One-time setup per company
2. Requires Twitter account login
3. Takes less than 1 minute
4. Once authorized, full automation is enabled
5. Can be revoked and re-authorized anytime
