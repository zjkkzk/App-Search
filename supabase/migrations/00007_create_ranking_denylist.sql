-- 黑名单表：aggregate-rankings 聚合前先排除这些无安装包的项目
CREATE TABLE IF NOT EXISTS ranking_denylist (
  owner TEXT NOT NULL,
  repo  TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (owner, repo)
);

-- 插入已确认无安装包的项目
INSERT INTO ranking_denylist (owner, repo, reason) VALUES
  ('cirosantilli', 'china-dictatroship-7',    'no installable assets'),
  ('ddwhan0123',   'Useful-Open-Source-Android','no installable assets'),
  ('fastlane',     'fastlane',                 'no installable assets'),
  ('fogleman',     'Craft',                    'no installable assets'),
  ('github-release','github-release',          'no installable assets'),
  ('GitHubDaily',  'GitHubDaily',              'no installable assets'),
  ('Guovin',       'iptv-api',                 'no installable assets'),
  ('johnno1962',   'injectionforxcode',         'no installable assets'),
  ('microsoft',    'rnx-kit',                  'no installable assets'),
  ('mock-server',  'mockserver-monorepo',       'no installable assets'),
  ('mykolaharmash','notelet',                  'no installable assets'),
  ('ninject',      'Ninject',                  'no installable assets'),
  ('OWASP',        'masvs',                    'no installable assets'),
  ('s7safe',       'android-h1',               'no installable assets'),
  ('welk1n',       'JNDI-Injection-Exploit',   'no installable assets'),
  ('wyouflf',      'xUtils3',                  'no installable assets'),
  ('xisohi',       'CHINA-IPTV',               'no installable assets')
ON CONFLICT (owner, repo) DO NOTHING;