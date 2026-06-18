-- 1. 删除 app_id=0 的垃圾行（所有 rank_type/period）
DELETE FROM app_rankings WHERE app_id = 0 OR app_id IS NULL;

-- 2. 删除 app_name 和 owner 都为空的无效行
DELETE FROM app_rankings WHERE (app_name IS NULL OR app_name = '') AND (owner IS NULL OR owner = '');

-- 3. 为 avatar_url 为空的记录，用 github.com/{owner}.png 补全
UPDATE app_rankings
SET avatar_url = 'https://github.com/' || owner || '.png?size=120'
WHERE (avatar_url IS NULL OR avatar_url = '')
  AND owner IS NOT NULL AND owner <> '';

-- 4. 同样修复 app_events 表中空 avatar_url
UPDATE app_events
SET avatar_url = 'https://github.com/' || owner || '.png?size=120'
WHERE (avatar_url IS NULL OR avatar_url = '')
  AND owner IS NOT NULL AND owner <> '';