/* eslint-disable */
/**
 * withAndroidInstallPackages.js
 *
 * 为 Android 构建添加 APK 安装所需的权限和 queries：
 *  1. REQUEST_INSTALL_PACKAGES — Android 8+ 安装 APK 必须声明
 *  2. queries/intent (ACTION_VIEW + APK mime) — Android 11+ 可见性
 *  3. queries/intent (ACTION_INSTALL_PACKAGE) — Android 11+ 可见性
 *
 * 幂等设计：重复 prebuild 不会重复插入。
 */
const { withAndroidManifest } = require('expo/config-plugins');

/**
 * 检查 uses-permission 数组中是否已存在指定权限
 */
function hasPermission(permissions, name) {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((p) => p?.$ && p.$['android:name'] === name);
}

/**
 * 检查 queries/intent 数组中是否已存在指定 action
 */
function hasQueryIntent(intents, actionName) {
  if (!Array.isArray(intents)) return false;
  return intents.some((i) => {
    const action = Array.isArray(i.action) ? i.action[0] : i.action;
    return action?.$ && action.$['android:name'] === actionName;
  });
}

const withAndroidInstallPackages = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // ── 1. 权限 ──────────────────────────────────────────────────────────────
    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const INSTALL_PERM = 'android.permission.REQUEST_INSTALL_PACKAGES';
    if (!hasPermission(manifest['uses-permission'], INSTALL_PERM)) {
      manifest['uses-permission'].push({ $: { 'android:name': INSTALL_PERM } });
    }

    // ── 2. queries block ─────────────────────────────────────────────────────
    if (!manifest.queries) manifest.queries = [{}];
    const queries = manifest.queries[0];
    if (!queries.intent) queries.intent = [];

    // ACTION_VIEW + APK mime（Android 11+ 可见性）
    const APK_VIEW_ACTION = 'android.intent.action.VIEW';
    const hasApkView = queries.intent.some((i) => {
      const action = Array.isArray(i.action) ? i.action[0] : i.action;
      const data = Array.isArray(i.data) ? i.data[0] : i.data;
      return (
        action?.$?.['android:name'] === APK_VIEW_ACTION &&
        data?.$?.['android:mimeType'] === 'application/vnd.android.package-archive'
      );
    });
    if (!hasApkView) {
      queries.intent.push({
        action: [{ $: { 'android:name': APK_VIEW_ACTION } }],
        data: [{ $: { 'android:mimeType': 'application/vnd.android.package-archive' } }],
      });
    }

    // ACTION_INSTALL_PACKAGE（Android 11+ 可见性）
    const INSTALL_ACTION = 'android.intent.action.INSTALL_PACKAGE';
    if (!hasQueryIntent(queries.intent, INSTALL_ACTION)) {
      queries.intent.push({ action: [{ $: { 'android:name': INSTALL_ACTION } }] });
    }

    return config;
  });
};

module.exports = withAndroidInstallPackages;
