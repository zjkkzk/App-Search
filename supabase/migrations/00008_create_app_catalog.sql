-- 服务端预处理的应用目录，只存有安装包的项目
CREATE TABLE IF NOT EXISTS app_catalog (
  id              BIGINT PRIMARY KEY,           -- GitHub repo id
  owner           TEXT NOT NULL,
  repo            TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  avatar_url      TEXT,
  stars           INT DEFAULT 0,
  forks           INT DEFAULT 0,
  language        TEXT,
  topics          TEXT[] DEFAULT '{}',
  platforms       TEXT[] DEFAULT '{}',          -- ['Android','iOS','Windows','macOS','Linux']
  latest_version  TEXT,
  latest_release_date TIMESTAMPTZ,
  total_downloads BIGINT DEFAULT 0,
  html_url        TEXT,
  updated_at      TIMESTAMPTZ,
  license         TEXT,
  open_issues_count INT DEFAULT 0,
  archived        BOOLEAN DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(owner, repo)
);

-- 全文搜索索引（中英文友好）
CREATE INDEX IF NOT EXISTS app_catalog_fts_idx
  ON app_catalog USING gin(to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(owner,'')));

-- 常用查询索引
CREATE INDEX IF NOT EXISTS app_catalog_stars_idx ON app_catalog(stars DESC);
CREATE INDEX IF NOT EXISTS app_catalog_updated_idx ON app_catalog(updated_at DESC);
CREATE INDEX IF NOT EXISTS app_catalog_platforms_idx ON app_catalog USING gin(platforms);
CREATE INDEX IF NOT EXISTS app_catalog_topics_idx ON app_catalog USING gin(topics);

-- RLS：允许匿名读取，只有 service_role 可写
ALTER TABLE app_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog_public_read" ON app_catalog FOR SELECT USING (true);
CREATE POLICY "catalog_service_write" ON app_catalog FOR ALL USING (auth.role() = 'service_role');