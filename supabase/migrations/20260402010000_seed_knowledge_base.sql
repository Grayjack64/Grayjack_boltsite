-- ============================================================
-- Seed Knowledge Base for Ora and The A Balm
-- ============================================================

-- =========================
-- ORA SKINCARE AI
-- =========================
-- Company ID: a88331bc-0222-4cf7-a123-8b917e4851db

-- Brand Voice
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'brand_voice', 'Ora Brand Personality',
'Warm, approachable, and authoritative. Like a knowledgeable best friend who happens to be a skincare expert. Confident in science but never condescending. Genuinely helpful — always prioritizes the person''s skin needs. Empathetic — acknowledges skin struggles without dismissing them. Encouraging — celebrates skin wins, no matter how small. Honest — won''t overpromise or give medical advice. Never diagnose skin conditions — suggest consulting a dermatologist for medical concerns.',
10, ARRAY['voice', 'tone', 'personality']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'brand_voice', 'Ora Tagline and Positioning',
'Tagline: "AI-Powered Personalized Skincare. Your glow, redefined." Ora is an AI-powered personalized skincare app available free on iOS and Android. Premium subscription: $4.99/month or $49.99/year for unlimited AI features.',
9, ARRAY['tagline', 'positioning', 'pricing']);

-- Product/Features
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'AI Skin Analysis',
'Comprehensive 6-step skin assessment quiz capturing skin type (dry, oily, combination, normal, sensitive), concerns (acne, aging, hyperpigmentation, redness, dryness, texture, dark circles, dullness), diagnosed conditions (eczema, psoriasis, rosacea, contact dermatitis, seborrheic dermatitis, keratosis pilaris, melasma, perioral dermatitis, fungal acne, vitiligo), age range, allergies/sensitivities, and budget preference (budget, mid-range, luxury). AI generates a personalized skin profile summary — like a digital dermatologist consultation.',
8, ARRAY['feature', 'skin analysis', 'quiz', 'profile']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Product Scanner',
'AI-powered camera scanner using xAI''s Grok 4.1 with vision capabilities. Point camera at any skincare product to instantly identify it, extract the complete INCI ingredient list, highlight key actives, flag allergens based on personal profile, and rate compatibility with skin type. Also works with gallery photos. Free: 5 scans/month. Premium: unlimited.',
8, ARRAY['feature', 'scanner', 'camera', 'ingredients']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Intelligent Routine Builder',
'Dual-column AM/PM routine layout with Anytime and Periodic Treatment sections. Drag products from library, reorder steps, AI-powered conflict detection cross-references every ingredient across the entire routine and flags dangerous combinations (retinol + AHA, vitamin C + benzoyl peroxide, etc.). Supports weekly/biweekly/custom treatment schedules. Real-time cloud sync.',
8, ARRAY['feature', 'routine', 'builder', 'conflicts']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'AI Skincare Chatbot',
'24/7 AI companion named "Ora" for skincare questions. Deeply personalized — every response informed by complete skin profile, current AM/PM routine with all ingredients, last 7 days of skin logs, and conversation history. Supports photo uploads for visual skin analysis. Organizes conversations into separate threads. Free: 10 messages/day. Premium: unlimited. Persistent medical disclaimer that AI advice isn''t a substitute for dermatological care.',
8, ARRAY['feature', 'chatbot', 'AI', 'assistant']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Daily Skin Tracking',
'Home screen doubles as daily skin journal. Rate skin condition 1-5 stars, add notes about changes, upload photos with pose/lighting guidance, check off routine steps. Tracks logging streaks for motivation. AI analyzes logs to find patterns — correlates skin ratings with habits, products, weather, and time.',
7, ARRAY['feature', 'tracking', 'journal', 'daily']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Progress Tracker',
'Track specific problem areas (forehead acne, cheek redness, dark circles, jawline breakouts) across any body region. Establish baseline photo, add follow-ups over time. AI performs timeline analysis, identifies if area is improving/stable/worsening. Before/after slider for visual comparison. AI generates insights like "Redness reduced approximately 40% since switching to centella moisturizer."',
7, ARRAY['feature', 'progress', 'before-after', 'tracking']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Shopping Assistant',
'In-store feature: point camera at products while shopping for real-time analysis. Evaluates fit for skin type, checks conflicts with existing routine, considers budget, and gives clear verdict: "great_fit", "caution", or "not_recommended" with detailed reasoning.',
7, ARRAY['feature', 'shopping', 'in-store', 'recommendations']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Smart Recommendations',
'Premium feature. AI analyzes current routine, identifies missing steps/categories, considers budget tier and sensitivities, recommends 4 products with detailed reasoning. Science-driven, personalized, considers complete skincare context — not just "what''s popular."',
6, ARRAY['feature', 'recommendations', 'premium']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Morning Brief',
'Premium feature. Daily personalized skincare tip based on profile, routine, and recent skin logs. Context-aware — if ratings declining, suggests adjustments; if improving, reinforces what''s working. Seasonal and routine-specific advice.',
6, ARRAY['feature', 'morning brief', 'tips', 'premium']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'feature', 'Ingredient Glossary',
'Searchable database of skincare ingredients. Each entry includes display/INCI names, plain-English explanation, skin concerns it addresses, known conflicts with other ingredients, suitable/unsuitable skin types, and category. Continuously enriched by AI analysis.',
6, ARRAY['feature', 'glossary', 'ingredients', 'education']);

-- Target Audience
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'target_audience', 'Ora Target Audience',
'Primary: Women aged 18-45 concerned with skincare and product effectiveness. Secondary: Anyone with sensitive skin, diagnosed conditions, or skincare confusion. Ingredient-conscious consumers, heavy product researchers, dermatology-aware (but not medical-seeking), digital-native skincare enthusiasts. All budget tiers.',
7, ARRAY['audience', 'demographics']);

-- App Links
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('a88331bc-0222-4cf7-a123-8b917e4851db', 'product', 'Ora App Download Links',
'App Store: https://apps.apple.com/us/app/ora-skincare/id6759684100 | Google Play: https://play.google.com/store/apps/details?id=co.oraai.app | Website: https://ora-ai.co',
9, ARRAY['download', 'links', 'app store']);

-- =========================
-- THE A BALM
-- =========================
-- Company ID: e57a627c-3b29-44d5-9396-a2478d33ac44

-- Brand Voice
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'brand_voice', 'The A Balm Brand Personality',
'Irreverent, sarcastic, funny, and unapologetically direct. Like your funniest gym buddy who also knows about muscle recovery. Mild swearing is OK (ass, damn, hell). Never corporate, never boring, never sound like a typical wellness brand. Never be mean-spirited — sarcastic about pain, not people. NOT FDA approved — lean into that humorously.',
10, ARRAY['voice', 'tone', 'personality']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'brand_voice', 'The A Balm Tagline and Examples',
'Tagline: "For when your body is being a real pain in the ass." Example phrases: "Tell your soreness to piss off." "Your muscles called. They said they hate you. We can help." "Not FDA approved, but your muscles will approve." "Making the world less sore, one jar at a time." Footer: "© 2026 THE A BALM • NOT FDA APPROVED BUT YOUR MUSCLES WILL APPROVE"',
9, ARRAY['tagline', 'examples', 'copy']);

-- Products
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'product', 'The A Balm Jar (2oz)',
'The OG. A thick, all-natural muscle relief balm you scoop and slather on wherever it hurts. $24.99. Best for wide area application — backs, legs, shoulders. Fun fact: It melts in extreme heat. We call that a feature, not a bug. Packed with the Secret Weapon Blend™.',
10, ARRAY['product', 'jar', 'flagship']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'product', 'The A Balm Pump (3oz)',
'Same legendary formula in a heat-resistant pump. $28.99. No more melted balm in your gym bag. Just pump, rub, and get back to whatever questionable exercise you were doing. Best for on-the-go athletes, hot climates, gym bags. Born because customers kept complaining about melted jars in their cars.',
10, ARRAY['product', 'pump', 'heat-resistant']);

INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'product', 'The A Balm Roll-On (1oz)',
'Precision targeting for that one annoying spot. $19.99. Roll it on without getting your hands all balmy. Perfect for necks, elbows, knees, and whatever else you managed to injure. The "I don''t want to touch it" option.',
10, ARRAY['product', 'roll-on', 'targeted']);

-- Ingredients
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'ingredient', 'The Secret Weapon Blend™',
'All-natural proprietary formula: Arnica Oil (inflammation assassin), Camphor Oil (deep-heat dealer), Ginger Oil (circulation booster), Peppermint Oil (cooling relief specialist), Clove Bud Oil (pain-numbing ninja), Oregano Oil (antimicrobial muscle whisperer), Bees Wax (holds the party together), Shea Butter (keeps skin from staging a revolt), Olive Oil + MCT Coconut Oil (absorption dream team), Vitamin E Oil (skin''s bodyguard).',
9, ARRAY['ingredients', 'formula', 'natural']);

-- Target Audience
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'target_audience', 'The A Balm Target Audience',
'Athletes and gym-goers who push too hard. Weekend warriors who regret Monday. Active people 25-55 who want natural recovery. CrossFitters, runners, lifters, cyclists, martial artists. Anyone who says "I''m too sore to move" at least once a week.',
8, ARRAY['audience', 'demographics', 'athletes']);

-- Differentiators
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'differentiator', 'Why The A Balm Is Different',
'100% natural ingredients — no chemicals, no synthetics. Three formats for every situation (jar, pump, roll-on). Proprietary Secret Weapon Blend™ with science-backed ingredients. Irreverent brand personality that doesn''t take itself too seriously. Not FDA approved — and proud of it (in a funny way). Made for real athletes, not wellness influencers.',
8, ARRAY['differentiator', 'unique', 'competitive']);

-- Website
INSERT INTO company_knowledge (company_id, category, title, content, priority, tags) VALUES
('e57a627c-3b29-44d5-9396-a2478d33ac44', 'product', 'The A Balm Website and Links',
'Website: https://www.theabalm.com | Instagram: @theabalm | Twitter: @the_a_balm',
9, ARRAY['links', 'website', 'social']);
