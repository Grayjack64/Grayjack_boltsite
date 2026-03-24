# Twitter Automation API Guide

## Quick Start

Your blog programs and automation scripts can now post to Twitter programmatically using the provided API client.

## Installation

```javascript
import TwitterAPIClient from './twitter-api-client.js';
const twitter = new TwitterAPIClient();
```

## Basic Usage

### Post a Tweet by Company Slug

```javascript
const result = await twitter.postTweetBySlug(
  'grayjack-holdings',
  'Check out our latest blog post!'
);

if (result.success) {
  console.log('Tweet posted!', result.tweet_id);
} else {
  console.error('Error:', result.error);
}
```

### Post a Tweet by Company ID

```javascript
const result = await twitter.postTweet(
  'company-uuid-here',
  'Your tweet text here'
);
```

## API Methods

### `postTweet(companyId, text)`
Posts a tweet for a specific company using their UUID.

**Parameters:**
- `companyId` (string): Company UUID from database
- `text` (string): Tweet text (max 280 characters)

**Returns:**
```javascript
{
  success: true,
  tweet_id: "1234567890",
  text: "Your tweet text"
}
// or
{
  success: false,
  error: "Error message"
}
```

### `postTweetBySlug(companySlug, text)`
Posts a tweet using the company's URL-safe slug instead of UUID.

**Parameters:**
- `companySlug` (string): Company slug (e.g., 'grayjack-holdings')
- `text` (string): Tweet text (max 280 characters)

**Returns:** Same as `postTweet()`

### `getCompanies()`
Retrieves all companies and their Twitter connection status.

**Returns:**
```javascript
[
  {
    id: "uuid",
    name: "Company Name",
    slug: "company-slug",
    twitter_connected: true,
    twitter_username: "username"
  }
]
```

### `getCompanyIdBySlug(slug)`
Gets a company's UUID from their slug.

**Returns:** Company UUID string or null

### `isTwitterConnected(companyId)`
Checks if a company has an active Twitter connection.

**Returns:** Boolean

## Real-World Examples

### Blog Post Automation

```javascript
import TwitterAPIClient from './twitter-api-client.js';

async function shareBlogPost(blogData) {
  const twitter = new TwitterAPIClient();

  const tweet = `📝 ${blogData.title}\n\n${blogData.excerpt}\n\nRead more: ${blogData.url}`;

  const result = await twitter.postTweetBySlug(
    blogData.companySlug,
    tweet
  );

  return result;
}

const blog = {
  title: "5 Marketing Trends for 2024",
  excerpt: "Stay ahead of the curve with these insights.",
  url: "https://example.com/blog/trends-2024",
  companySlug: "grayjack-marketing"
};

shareBlogPost(blog);
```

### Multi-Company Announcement

```javascript
async function broadcastAnnouncement(message) {
  const twitter = new TwitterAPIClient();
  const companies = await twitter.getCompanies();

  const results = [];

  for (const company of companies) {
    if (company.twitter_connected) {
      const result = await twitter.postTweet(company.id, message);
      results.push({
        company: company.name,
        success: result.success
      });

      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return results;
}

broadcastAnnouncement("Big announcement coming tomorrow! Stay tuned 🎉");
```

### Scheduled Content

```javascript
async function scheduledPost() {
  const twitter = new TwitterAPIClient();

  const posts = [
    { slug: 'company-a', text: 'Monday motivation! 💪' },
    { slug: 'company-b', text: 'Tech tip Tuesday!' },
    { slug: 'company-c', text: 'Wisdom Wednesday 🧠' }
  ];

  for (const post of posts) {
    await twitter.postTweetBySlug(post.slug, post.text);
  }
}
```

### Error Handling

```javascript
async function safePost(companySlug, text) {
  const twitter = new TwitterAPIClient();

  const isConnected = await twitter.isTwitterConnected(
    await twitter.getCompanyIdBySlug(companySlug)
  );

  if (!isConnected) {
    console.log(`⚠️ ${companySlug} doesn't have Twitter connected`);
    return;
  }

  const result = await twitter.postTweetBySlug(companySlug, text);

  if (result.success) {
    console.log(`✅ Posted to ${companySlug}: ${result.tweet_id}`);
  } else {
    console.error(`❌ Failed to post to ${companySlug}: ${result.error}`);
  }
}
```

## Integration with Blog Systems

### WordPress Example (Conceptual)

```javascript
// After publishing a blog post in WordPress
add_action('publish_post', async function(postId) {
  const post = get_post(postId);
  const twitter = new TwitterAPIClient();

  const tweet = `${post.post_title}\n\n${get_permalink(postId)}`;

  await twitter.postTweetBySlug('your-company-slug', tweet);
});
```

### Node.js Blog System

```javascript
import TwitterAPIClient from './twitter-api-client.js';

class BlogPublisher {
  constructor() {
    this.twitter = new TwitterAPIClient();
  }

  async publishArticle(article) {
    await this.saveToDatabase(article);

    const tweetText = this.formatTweet(article);
    await this.twitter.postTweetBySlug(article.companySlug, tweetText);

    console.log('Article published and tweeted!');
  }

  formatTweet(article) {
    const maxLength = 250;
    let text = article.title;

    if (text.length > maxLength) {
      text = text.substring(0, maxLength - 3) + '...';
    }

    return `${text}\n\n🔗 ${article.url}`;
  }

  async saveToDatabase(article) {
    // Your database logic
  }
}
```

## Direct HTTP API

If you prefer not to use the JavaScript client, you can call the API directly:

### POST Tweet

```bash
curl -X POST \
  https://edkisozjywgkgqczglbm.supabase.co/functions/v1/twitter-oauth/post \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "company-uuid",
    "text": "Your tweet text"
  }'
```

### Response Format

**Success:**
```json
{
  "success": true,
  "tweet_id": "1234567890",
  "text": "Your tweet text"
}
```

**Error:**
```json
{
  "error": "Error message",
  "details": "Additional error information"
}
```

## Best Practices

1. **Rate Limiting**: Add delays between posts (1-2 seconds minimum)
2. **Character Limit**: Always check tweet length is ≤ 280 characters
3. **Error Handling**: Always check `result.success` before proceeding
4. **Connection Check**: Verify Twitter is connected before posting
5. **Logging**: Log all posting attempts for debugging

## Support

For issues or questions about the Twitter automation API, check:
- Edge function logs in Supabase dashboard
- Company connection status in `/dashboard.html`
- Database tables: `companies` and `twitter_accounts`
