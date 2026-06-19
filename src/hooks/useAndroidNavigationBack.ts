/**
 * useAndroidNavigationBack
 *
 * Android 系统返回键处理 —— 必须在 Stack 内部的子组件中调用（如 (tabs)/_layout.tsx），
 * 不能在根 _layout.tsx 中调用，否则 usePathname/useRouter 无法正常工作。
 *
 * 行为规则：
 *  1. 在 Stack 子页面（detail / downloads / favorites / search-history / rankings）
 *     → router.back() 返回上一级，由 expo-router 决定返回目标
 *  2. 在非首页 Tab（discover / ranking / search / profile）
 *     → router.replace('/(tabs)/home') 回到首页 Tab
 *  3. 已在首页 /home
 *     → 第一次：Toast 提示"再按一次退出应用"
 *     → 2 秒内第二次：BackHandler.exitApp()
 *
 * 设计要点：
 *  - 完全不依赖 router.canGoBack()、NavigationContainerRef、JS 历史栈
 *  - 始终 return true 消费事件，防止原生默认退出行为
 *  - pathnameRef 保持最新路径，BackHandler 闭包只引用 ref（注册一次即可）
 */
import { useEffect, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

// Tab 屏幕路径集合
const HOME_PATH = '/home';
const NON_HOME_TABS = new Set(['/discover', '/ranking', '/search', '/profile']);

// Stack 子页面路径前缀 / 精确路径（非 Tab 的页面）
function isStackScreen(path: string): boolean {
  return (
    path.startsWith('/detail/') ||
    path === '/downloads' ||
    path === '/favorites' ||
    path === '/search-history' ||
    path === '/rankings'
  );
}

export function useAndroidNavigationBack() {
  const pathname = usePathname();
  const router = useRouter();

  // 始终保持最新 pathname，让 BackHandler 闭包读取
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // 双击退出计数
  const exitPressRef = useRef(0);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 只注册一次 BackHandler，通过 ref 读取最新状态
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = pathnameRef.current;

      // ① Stack 子页面 → 返回上一级（expo-router 决定目标）
      if (isStackScreen(current)) {
        router.back();
        return true;
      }

      // ② 非首页 Tab → 回到首页
      if (NON_HOME_TABS.has(current)) {
        exitPressRef.current = 0;
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        router.replace('/(tabs)/home' as any);
        return true;
      }

      // ③ 首页（/home 或其他未知路径） → 双击退出
      exitPressRef.current += 1;
      if (exitPressRef.current === 1) {
        ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
        exitTimerRef.current = setTimeout(() => {
          exitPressRef.current = 0;
        }, 2000);
        return true;
      }
      // 第二次按下：退出
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitPressRef.current = 0;
      BackHandler.exitApp();
      return true;
    });

    return () => {
      sub.remove();
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
