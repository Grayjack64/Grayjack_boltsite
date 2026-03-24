/**
 * Example: Automated Blog Post to Twitter
 *
 * This demonstrates how your blog writing programs can automatically
 * post to Twitter when a new blog entry is created.
 */

import TwitterAPIClient from './twitter-api-client.js';

const twitterClient = new TwitterAPIClient();

async function publishBlogToTwitter() {
  const blogPost = {
    title: "10 Tips for Effective Social Media Marketing",
    url: "https://grayjackholdings.com/blog/social-media-tips",
    companySlug: "grayjack-marketing"
  };

  const tweetText = `📝 New Blog Post: ${blogPost.title}\n\nRead more: ${blogPost.url}`;

  const result = await twitterClient.postTweetBySlug(
    blogPost.companySlug,
    tweetText
  );

  if (result.success) {
    console.log(`✅ Tweet posted successfully!`);
    console.log(`Tweet ID: ${result.tweet_id}`);
    console.log(`Text: ${result.text}`);
  } else {
    console.error(`❌ Failed to post tweet: ${result.error}`);
  }
}

async function postMultipleCompanies() {
  const companies = await twitterClient.getCompanies();

  console.log(`Found ${companies.length} companies:`);
  companies.forEach(company => {
    console.log(`- ${company.name} (${company.slug}): ${company.twitter_connected ? '✓ Connected' : '✗ Not connected'}`);
  });

  const announcement = "Exciting news! We've just launched our new website. Check it out! 🚀";

  for (const company of companies) {
    if (company.twitter_connected) {
      console.log(`\nPosting to ${company.name}...`);
      const result = await twitterClient.postTweet(company.id, announcement);

      if (result.success) {
        console.log(`✅ Posted to @${company.twitter_username}`);
      } else {
        console.error(`❌ Failed: ${result.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function conditionalPosting() {
  const companySlug = "grayjack-holdings";

  const isConnected = await twitterClient.isTwitterConnected(
    await twitterClient.getCompanyIdBySlug(companySlug)
  );

  if (isConnected) {
    const result = await twitterClient.postTweetBySlug(
      companySlug,
      "Our latest quarterly report is now available!"
    );
    console.log(result.success ? "✅ Posted" : `❌ Error: ${result.error}`);
  } else {
    console.log("⚠️ Twitter not connected for this company");
  }
}

publishBlogToTwitter();
