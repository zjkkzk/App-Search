// ─── 应用分类统一字典 ────────────────────────────────────────────────────────────
// 首页宫格 / 发现页筛选 / 场景合集 均复用此文件，保证分类一致性

export interface TaxonomyCategory {
  key: string;
  label: string;
  icon: string;        // Ionicons 图标名
  color: string;       // 主色
  bg: string;          // 图标背景色
  topics: string[];    // search-catalog topics 参数
}

/** 主分类列表（首页宫格 / 发现页分类筛选共用） */
export const TAXONOMY_CATEGORIES: TaxonomyCategory[] = [
  {
    key: 'devtools',
    label: '开发工具',
    icon: 'hammer',
    color: '#9C27B0',
    bg: '#F3E5F5',
    topics: ['developer-tools', 'terminal', 'editor', 'ide', 'ssh', 'git', 'cli'],
  },
  {
    key: 'productivity',
    label: '效率工具',
    icon: 'flash',
    color: '#FF6B35',
    bg: '#FFF3E0',
    topics: ['productivity', 'notes', 'todo', 'calendar', 'automation', 'file-manager'],
  },
  {
    key: 'media',
    label: '影音媒体',
    icon: 'musical-notes',
    color: '#E91E63',
    bg: '#FCE4EC',
    topics: ['media', 'music', 'video', 'player', 'streaming', 'podcast', 'photos', 'youtube'],
  },
  {
    key: 'privacy',
    label: '隐私安全',
    icon: 'shield-checkmark',
    color: '#FF5722',
    bg: '#FBE9E7',
    topics: ['privacy', 'security', 'password-manager', 'vpn', 'network'],
  },
  {
    key: 'game',
    label: '游戏娱乐',
    icon: 'game-controller',
    color: '#4CAF50',
    bg: '#E8F5E9',
    topics: ['game', 'gaming', 'emulator'],
  },
  {
    key: 'social',
    label: '社交通讯',
    icon: 'chatbubbles',
    color: '#2196F3',
    bg: '#E3F2FD',
    topics: ['social', 'chat', 'messaging', 'communication'],
  },
  {
    key: 'utility',
    label: '系统工具',
    icon: 'settings',
    color: '#607D8B',
    bg: '#ECEFF1',
    topics: ['utility', 'system', 'launcher', 'backup', 'cleaner'],
  },
  {
    key: 'selfhost',
    label: '自托管',
    icon: 'server',
    color: '#00897B',
    bg: '#E0F2F1',
    topics: ['self-hosted', 'homelab', 'docker', 'server', 'selfhosted'],
  },
];

/** 场景合集（首页"装机必备"模块） */
export interface SceneCollection {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bg: string;
  topics: string[];
  sort: string;
}

export const SCENE_COLLECTIONS: SceneCollection[] = [
  {
    key: 'dev-starter',
    title: '开发者装机',
    subtitle: '终端 · 编辑器 · Git 工具',
    icon: 'code-slash',
    color: '#9C27B0',
    bg: '#F3E5F5',
    topics: ['terminal', 'editor', 'git', 'ssh', 'cli', 'ide'],
    sort: 'stars',
  },
  {
    key: 'privacy-first',
    title: '隐私优先',
    subtitle: '密码管理 · VPN · 安全工具',
    icon: 'lock-closed',
    color: '#FF5722',
    bg: '#FBE9E7',
    topics: ['privacy', 'password-manager', 'vpn', 'security'],
    sort: 'stars',
  },
  {
    key: 'cross-platform',
    title: '跨平台精品',
    subtitle: 'Android · iOS · Windows · macOS',
    icon: 'layers',
    color: '#1677FF',
    bg: '#EBF3FF',
    topics: ['cross-platform', 'productivity', 'notes'],
    sort: 'stars',
  },
  {
    key: 'media-tools',
    title: '影音下载',
    subtitle: '视频 · 音乐 · 播客工具',
    icon: 'download',
    color: '#E91E63',
    bg: '#FCE4EC',
    topics: ['youtube', 'streaming', 'music', 'podcast', 'video'],
    sort: 'stars',
  },
  {
    key: 'android-open',
    title: 'Android 开源',
    subtitle: '最佳 Android 替代品',
    icon: 'logo-android',
    color: '#3DDC84',
    bg: '#E8F5E9',
    topics: ['android'],
    sort: 'stars',
  },
  {
    key: 'self-hosted',
    title: '自托管工具',
    subtitle: 'Homelab · Docker · 服务器',
    icon: 'server',
    color: '#00897B',
    bg: '#E0F2F1',
    topics: ['self-hosted', 'homelab', 'docker'],
    sort: 'stars',
  },
];

/** 平台配置（首页平台入口 / 发现页平台筛选共用） */
export interface PlatformConfig {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
}

export const PLATFORM_LIST: PlatformConfig[] = [
  { key: 'Android', label: 'Android',  icon: 'logo-android',    color: '#3DDC84', bg: '#E8F5E9' },
  { key: 'iOS',     label: 'iOS',       icon: 'logo-apple',      color: '#1A1A1A', bg: '#F5F5F7' },
  { key: 'Windows', label: 'Windows',   icon: 'logo-windows',    color: '#0078D7', bg: '#E3F2FD' },
  { key: 'macOS',   label: 'macOS',     icon: 'logo-apple',      color: '#555',    bg: '#F5F5F5' },
  { key: 'Linux',   label: 'Linux',     icon: 'terminal-outline', color: '#E5A00D', bg: '#FFF8E1' },
];

/** 编程语言筛选选项 */
export const LANGUAGE_LIST = [
  '全部', 'TypeScript', 'Kotlin', 'Swift', 'Dart', 'Java',
  'Python', 'Rust', 'Go', 'C#', 'C++',
];

/** Stars 门槛筛选 */
export interface StarsFilter {
  key: string;
  label: string;
  value: number;
}
export const STARS_FILTERS: StarsFilter[] = [
  { key: 'any',  label: '全部', value: 0 },
  { key: '100',  label: '100+', value: 100 },
  { key: '1k',   label: '1k+',  value: 1000 },
  { key: '5k',   label: '5k+',  value: 5000 },
  { key: '10k',  label: '10k+', value: 10000 },
];

/** 排序选项（发现页用） */
export interface SortOption {
  key: string;
  label: string;
  icon: string;
}
export const SORT_OPTIONS: SortOption[] = [
  { key: 'stars',     label: 'Stars',    icon: 'star' },
  { key: 'updated',   label: '最新更新', icon: 'time-outline' },
  { key: 'downloads', label: '下载量',   icon: 'download-outline' },
  { key: 'forks',     label: 'Forks',    icon: 'git-branch-outline' },
];
