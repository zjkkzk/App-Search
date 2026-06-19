/**
 * useAndroidNavigationBack
 *
 * Android 系统返回键统一处理方案（JS 路由历史栈）
 *
 * 行为规则：
 *  1. 有 JS 历史上一页   → router.replace(previous) 返回上一级
 *  2. 非首页 Tab（discover/ranking/search/profile）→ 回到 home
 *  3. 已在首页           → 第一次提示"再按一次退出"，2秒内第二次 exitApp()
 *
 * 设计要点：
 *  - BackHandler 只注册一次（根布局），避免多个 handler 焦点竞争
 *  - 始终 return true 消费事件，永不依赖 canGoBack() 或原生 Fragment 栈
 *  - 用 isGoingBackRef 区分"用户导航"和"程序回退"，防止回退时重复入栈
 */
import { useEffect, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import type { RelativePathString } from 'expo-router';

// 非首页的 Tab 路径（pathname 不含 route group 前缀）
const NON_HOME_TABS = new Set(['/discover', '/ranking', '/search', '/profile']);

export function useAndroidNavigationBack() {
  const pathname = usePathname();
  const router = useRouter();

  const historyRef = useRef<string[]>([]);
  const pathnameRef = useRef(pathname);
  const isGoingBackRef = useRef(false);
  const exitPressRef = useRef(0);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步最新 pathname 到 ref（供 BackHandler 闭包读取）
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // 记录路由历史
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // 程序主动回退时跳过入栈
    if (isGoingBackRef.current) {
      isGoingBackRef.current = false;
      return;
    }

    // 避免连续重复路径入栈（Tab 切换同一 Tab 等情况）
    const last = historyRef.current[historyRef.current.length - 1];
    if (last !== pathname) {
      historyRef.current.push(pathname);
    }
  }, [pathname]);

  // 注册 BackHandler（仅注册一次）
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = pathnameRef.current;
      const history = historyRef.current;

      // ① 有历史上一页 → 返回上一级
      if (history.length > 1) {
        history.pop(); // 弹出当前页
        const previous = history[history.length - 1];
        isGoingBackRef.current = true;
        // 重置退出计数，避免跨页面残留
        exitPressRef.current = 0;
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        router.replace(previous as RelativePathString);
        return true;
      }

      // ② 非首页 Tab → 回到首页
      if (NON_HOME_TABS.has(current)) {
        isGoingBackRef.current = true;
        exitPressRef.current = 0;
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        router.replace('/(tabs)/home' as RelativePathString);
        return true;
      }

      // ③ 已在首页 → 双击退出
      exitPressRef.current += 1;
      if (exitPressRef.current === 1) {
        ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
        exitTimerRef.current = setTimeout(() => {
          exitPressRef.current = 0;
        }, 2000);
        return true;
      }

      // 第二次按下，退出应用
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitPressRef.current = 0;
      BackHandler.exitApp();
      return true;
    });

    return () => {
      sub.remove();
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []); // 空依赖：只注册一次，通过 ref 读取最新状态
}
