# App Search - 开源应用商店

<div align="center">

![Runtime](https://img.shields.io/badge/Runtime-Expo%20App%20%7C%20Web-2391FF?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Expo](https://img.shields.io/badge/Expo-55-blueviolet?style=flat-square)

**发现、探索、安装优质开源应用**

[快速开始](#快速开始) · [功能](#特性) · [项目结构](#项目结构) · [截图](#截图)

</div>

---

## ✨ 特性

### 🔍 智能搜索
- GitHub 开源仓库全文搜索
- 按平台、应用类型、收藏量筛选
- 搜索历史自动记录

### 📱 安装资产识别
项目会从 GitHub Release 中识别常见安装包格式，方便用户找到可安装的开源应用。当前仓库尚未提供自身的 Android、iOS、Windows、macOS 或 Linux 安装包构建产物。

| 目标平台 | 可识别格式 |
|------|----------|
| Android | APK |
| iOS | IPA |
| macOS | DMG / PKG |
| Windows | EXE / MSI |
| Linux | AppImage / DEB / RPM |

### 🏆 热门榜单
- 热门应用
- 下载排行
- 收藏排行
- 趋势应用

### 💾 本地管理
- 收藏应用
- 下载记录
- 搜索历史
- 本地缓存

### 安卓启动体验
- 浅色主题全屏启动页，背景色统一为 `#F8FBFF`
- 原生 Expo 启动图与 React Native 启动覆盖层视觉一致
- 包含品牌图标、产品名称、标语与轻量加载反馈

---

## 当前功能入口
- `/` / `src/app/(tabs)/index.tsx`：首页入口
- `/search` / `src/app/(tabs)/search.tsx`：搜索、热词、历史记录、分页加载
- `/ranking` / `src/app/(tabs)/ranking.tsx`：榜单页
- `/discover` / `src/app/(tabs)/discover.tsx`：发现页
- `/favorites`：收藏列表
- `/downloads`：下载记录
- `/detail/[id]`：应用详情页

## 数据架构
- 本地数据：Expo SQLite / Web localStorage，用于收藏、下载记录、搜索历史和缓存
- 云端数据：Supabase `app_catalog`、`app_events`、`search_hot_words` 等表
- 搜索链路：前端搜索页调用服务端智能搜索或 Supabase 目录查询，结果侧重可安装开源应用

## 搜索与过滤优化建议
- 前端：增加平台、语言、最低 stars、更新时间、是否有 Release 安装包等筛选控件，并将筛选条件体现在结果摘要中
- 前端：为搜索输入增加 300ms 防抖、取消过期请求、空结果推荐相近热词，降低重复请求和用户等待感
- 后端：将当前多字段 `ILIKE` 搜索升级为带权重的全文搜索 RPC，支持 `platforms/topics/language/min_stars/sort/page/per_page` 参数
- 后端：为安装包状态、平台数组、更新时间与热度字段建立组合索引或物化视图，避免客户端二次过滤和大范围扫描
- 安全：统一维护服务端敏感词/黑名单规则，前端仅做即时提示，最终过滤结果以服务端为准

## 未完成事项与下一步
- 将高级筛选 UI 与服务端 RPC 参数打通
- 补充搜索排序策略：综合 stars、更新时间、下载量、安装包可信度
- 为启动页在不同 Android 分辨率上补充截图回归检查

---

<div align="center">

**如果这个项目对你有帮助，请点个 ⭐️**

</div>
