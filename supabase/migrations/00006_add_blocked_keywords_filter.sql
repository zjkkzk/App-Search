-- 1. 创建违禁词表
CREATE TABLE IF NOT EXISTS blocked_keywords (
  keyword TEXT PRIMARY KEY,
  reason  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 预置常见低俗/违规词（中英文常见类别）
INSERT INTO blocked_keywords (keyword, reason) VALUES
  -- 色情类
  ('色情','pornographic'),('裸体','pornographic'),('黄片','pornographic'),
  ('成人','pornographic'),('av','pornographic'),('porn','pornographic'),
  ('nude','pornographic'),('xxx','pornographic'),('sex','pornographic'),
  ('18+','pornographic'),('约炮','pornographic'),('嫖','pornographic'),
  -- 赌博类
  ('赌博','gambling'),('赌场','gambling'),('博彩','gambling'),
  ('彩票作弊','gambling'),('老虎机','gambling'),
  -- 毒品类
  ('毒品','drugs'),('大麻','drugs'),('冰毒','drugs'),('海洛因','drugs'),
  ('可卡因','drugs'),('drug','drugs'),('weed','drugs'),
  -- 暴力/违法类
  ('炸弹制作','violence'),('枪支购买','violence'),('杀人','violence'),
  ('暗网','illegal'),('黑客攻击','illegal'),('钓鱼网站','illegal')
ON CONFLICT (keyword) DO NOTHING;

-- 3. 从 search_hot_words 删除已有违规词
DELETE FROM search_hot_words
WHERE LOWER(keyword) IN (SELECT LOWER(keyword) FROM blocked_keywords);

-- 4. 创建过滤视图，供前端直接查询
CREATE OR REPLACE VIEW safe_hot_words AS
SELECT s.keyword, s.search_count, s.updated_at
FROM search_hot_words s
WHERE NOT EXISTS (
  SELECT 1 FROM blocked_keywords b
  WHERE LOWER(s.keyword) LIKE '%' || LOWER(b.keyword) || '%'
)
AND LENGTH(s.keyword) >= 2
ORDER BY s.search_count DESC;