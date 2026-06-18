
-- ── app_events：全局用户行为事件表 ──────────────────────────────────────────
CREATE TABLE app_events (
  id               bigserial PRIMARY KEY,
  app_id           bigint       NOT NULL,
  app_name         text         NOT NULL DEFAULT '',
  owner            text         NOT NULL DEFAULT '',
  repo             text         NOT NULL DEFAULT '',
  avatar_url       text         NOT NULL DEFAULT '',
  event_type       text         NOT NULL CHECK (event_type IN ('search','view','download','favorite')),
  keyword          text,                        -- 搜索关键词（event_type='search' 时填充）
  platform         text,                        -- 应用平台标签
  device_id        text         NOT NULL DEFAULT '',  -- 匿名设备 ID
  created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_events_app_id    ON app_events (app_id);
CREATE INDEX idx_app_events_type_time ON app_events (event_type, created_at DESC);
CREATE INDEX idx_app_events_device    ON app_events (device_id);

ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

-- 任何人（含匿名）均可写入事件
CREATE POLICY "anon_insert_events" ON app_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 禁止客户端读取原始事件（只允许读聚合排行榜）
CREATE POLICY "no_direct_select" ON app_events
  FOR SELECT USING (false);

-- ── app_rankings：聚合排行榜表 ───────────────────────────────────────────────
CREATE TABLE app_rankings (
  id               bigserial PRIMARY KEY,
  rank_type        text        NOT NULL,   -- 'download','favorite','view','search_hit','hot'
  period           text        NOT NULL,   -- 'week','month','all'
  app_id           bigint      NOT NULL,
  app_name         text        NOT NULL DEFAULT '',
  owner            text        NOT NULL DEFAULT '',
  repo             text        NOT NULL DEFAULT '',
  avatar_url       text        NOT NULL DEFAULT '',
  score            numeric     NOT NULL DEFAULT 0,
  download_count   int         NOT NULL DEFAULT 0,
  favorite_count   int         NOT NULL DEFAULT 0,
  view_count       int         NOT NULL DEFAULT 0,
  rank_position    int         NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rank_type, period, app_id)
);

CREATE INDEX idx_rankings_type_period_rank ON app_rankings (rank_type, period, rank_position ASC);

ALTER TABLE app_rankings ENABLE ROW LEVEL SECURITY;

-- 任何人可读排行榜
CREATE POLICY "public_read_rankings" ON app_rankings
  FOR SELECT USING (true);

-- 仅 service_role 可写（Edge Function 聚合时使用）
CREATE POLICY "service_write_rankings" ON app_rankings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── search_hot_words：搜索热词榜 ─────────────────────────────────────────────
CREATE TABLE search_hot_words (
  id            bigserial PRIMARY KEY,
  keyword       text        NOT NULL UNIQUE,
  search_count  int         NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE search_hot_words ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_hotwords" ON search_hot_words
  FOR SELECT USING (true);

CREATE POLICY "service_write_hotwords" ON search_hot_words
  FOR ALL TO service_role USING (true) WITH CHECK (true);
