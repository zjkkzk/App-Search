/* eslint-disable */
/**
 * withAndroidDoubleBackExit.js — v281
 *
 * 【根本修复】将 AndroidManifest 的 enableOnBackInvokedCallback 改为 false
 *
 * 问题根因：
 *   Expo SDK 55 默认开启 android:enableOnBackInvokedCallback="true"，
 *   启用 Android 13+ 的新预测返回手势 API（OnBackInvokedCallback）。
 *   然而 ReactActivityDelegateWrapper 在这条新路径下存在缺陷——
 *   返回键事件无法路由至 JS 层，导致 BackHandler.addEventListener
 *   永远收不到事件，JS 所有返回键处理（useFocusEffect + BackHandler）全部失效，
 *   系统直接调用 finish() 退出应用。
 *
 * 修复方案：
 *   1. withAndroidManifest：将 enableOnBackInvokedCallback 改为 false，
 *      恢复传统 KEYCODE_BACK → BackHandler 链路，各页面 JS 返回键正常工作。
 *   2. withDangerousMod（MainActivity.kt）：覆写 invokeDefaultOnBackPressed()
 *      作为兜底（JS 未拦截时），实现原生双击退出，并确保 Toast 提示。
 *
 * 幂等标记：'// @double-back-exit-v281'
 */

const { withDangerousMod, withAndroidManifest } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

const PATCH_MARKER = '// @double-back-exit-v281';

// ── Step 1: 修改 AndroidManifest ──────────────────────────────────────────────
const withDisableOnBackInvoked = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const app = manifest.manifest.application?.[0];
    if (app && app.$) {
      // 关闭新预测返回 API，恢复传统 BackHandler 事件链
      app.$['android:enableOnBackInvokedCallback'] = 'false';
      console.log('[withAndroidDoubleBackExit] Set enableOnBackInvokedCallback=false');
    }
    return config;
  });
};

// ── Step 2: 覆写 invokeDefaultOnBackPressed()（兜底双击退出）────────────────
const withNativeDoubleExit = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      // 动态查找 MainActivity.kt
      const javaDir = path.join(projectRoot, 'android/app/src/main/java');
      let mainActivityPath = null;
      if (fs.existsSync(javaDir)) {
        const find = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
              const r = find(path.join(dir, entry.name));
              if (r) return r;
            } else if (entry.name === 'MainActivity.kt') {
              return path.join(dir, entry.name);
            }
          }
          return null;
        };
        mainActivityPath = find(javaDir);
      }

      if (!mainActivityPath) {
        console.warn('[withAndroidDoubleBackExit] MainActivity.kt not found, skipping');
        return config;
      }

      let contents = fs.readFileSync(mainActivityPath, 'utf8');

      // 幂等检查：已打 v281 标记则跳过
      if (contents.includes(PATCH_MARKER)) {
        console.log('[withAndroidDoubleBackExit] Already patched (v281), skipping');
        return config;
      }

      // ── 清理旧版注入 ──────────────────────────────────────────────────────
      contents = contents.replace(
        /\n\n  private var backPressCount[^\n]+\n  private val backPressHandler[^\n]+\n  private val resetBackPress[^\n]+/g,
        ''
      );
      contents = contents.replace(
        /\n?\s*onBackPressedDispatcher\.addCallback\([\s\S]*?\}\)\s*\n/g,
        '\n'
      );
      contents = contents.replace(/\nimport androidx\.activity\.OnBackPressedCallback\n?/g, '\n');

      // ── 1. 添加 import ────────────────────────────────────────────────────
      for (const imp of ['import android.os.Handler', 'import android.os.Looper', 'import android.widget.Toast']) {
        if (!contents.includes(imp)) {
          contents = contents.replace(/(^import .+$)/m, `$1\n${imp}`);
        }
      }

      // ── 2. 在 class body 添加字段 ─────────────────────────────────────────
      if (!contents.includes('private var backPressCount')) {
        contents = contents.replace(
          /(class MainActivity[^{]*\{)/,
          `$1\n\n  private var backPressCount = 0\n  private val backPressHandler = Handler(Looper.getMainLooper())\n  private val resetBackPress = Runnable { backPressCount = 0 }`
        );
      }

      // ── 3. 覆写 invokeDefaultOnBackPressed()（兜底，JS 未拦截时才触发）─────
      const newMethod = `override fun invokeDefaultOnBackPressed() {
    ${PATCH_MARKER}
    backPressCount++
    if (backPressCount == 1) {
      Toast.makeText(this, "再按一次退出应用", Toast.LENGTH_SHORT).show()
      backPressHandler.postDelayed(resetBackPress, 2000)
    } else {
      backPressHandler.removeCallbacks(resetBackPress)
      backPressCount = 0
      finish()
    }
  }`;

      if (contents.includes('override fun invokeDefaultOnBackPressed')) {
        // 替换已有方法（兼容不同缩进）
        contents = contents.replace(
          /override fun invokeDefaultOnBackPressed\(\)[\s\S]*?\n(\s{0,4})\}/,
          (match, indent) => newMethod
        );
      } else {
        contents = contents.replace(
          /(override fun getMainComponentName)/,
          `${newMethod}\n\n  $1`
        );
      }

      fs.writeFileSync(mainActivityPath, contents, 'utf8');
      console.log('[withAndroidDoubleBackExit] Patched (v281)', mainActivityPath);
      return config;
    },
  ]);
};

// 组合两个 mod
const withAndroidDoubleBackExit = (config) => {
  config = withDisableOnBackInvoked(config);
  config = withNativeDoubleExit(config);
  return config;
};

module.exports = withAndroidDoubleBackExit;
