CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  username TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS platforms_user_platform_unique ON platforms(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_platforms_user_id ON platforms(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  caption TEXT,
  media_type TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  permalink TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_user_platform_post_unique ON posts(user_id, platform, platform_post_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_published ON posts(user_id, published_at);

CREATE TABLE IF NOT EXISTS post_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  setting TEXT,
  lighting TEXT,
  face_visible INTEGER,
  text_overlay INTEGER,
  visual_style TEXT,
  caption_length INTEGER,
  hook_type TEXT,
  cta_present INTEGER,
  cta_type TEXT,
  caption_tone TEXT,
  emoji_count INTEGER,
  hashtag_count INTEGER,
  transcript TEXT,
  spoken_hook TEXT,
  key_frame_analysis TEXT,
  raw_analysis TEXT,
  analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS post_analysis_post_unique ON post_analysis(post_id);
CREATE INDEX IF NOT EXISTS idx_post_analysis_user_id ON post_analysis(user_id);

CREATE TABLE IF NOT EXISTS post_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  impressions INTEGER,
  reach INTEGER,
  engagement INTEGER,
  saves INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  score INTEGER,
  upvote_ratio REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS post_insights_post_date_unique ON post_insights(post_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_post_insights_user_id ON post_insights(user_id);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  follower_count INTEGER,
  media_count INTEGER,
  reach INTEGER,
  impressions INTEGER,
  profile_views INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS account_snapshots_user_platform_date_unique ON account_snapshots(user_id, platform, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_user_id ON account_snapshots(user_id);

CREATE TABLE IF NOT EXISTS demographics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS demographics_unique ON demographics(user_id, platform, snapshot_date, metric, key);
CREATE INDEX IF NOT EXISTS idx_demographics_user_id ON demographics(user_id);

CREATE TABLE IF NOT EXISTS content_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  report_json TEXT NOT NULL,
  posts_analyzed INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_insights_user_id ON content_insights(user_id);
