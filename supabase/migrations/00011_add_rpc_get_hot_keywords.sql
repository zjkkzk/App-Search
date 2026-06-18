
-- 全局热搜词 RPC：SECURITY DEFINER 绕过 RLS，返回聚合后的 top-N 关键词
CREATE OR REPLACE FUNCTION public.get_hot_keywords(limit_n int DEFAULT 20)
RETURNS TABLE(keyword text, cnt bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    lower(trim(keyword)) AS keyword,
    COUNT(*) AS cnt
  FROM app_events
  WHERE event_type = 'search'
    AND keyword IS NOT NULL
    AND length(trim(keyword)) >= 2
  GROUP BY lower(trim(keyword))
  ORDER BY cnt DESC
  LIMIT limit_n;
$$;

-- 允许 anon 和 authenticated 角色调用
GRANT EXECUTE ON FUNCTION public.get_hot_keywords(int) TO anon, authenticated;
