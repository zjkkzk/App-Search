/**
 * useAndroidExitBack
 *
 * 专为 Tab 屏幕设计的 Android 返回键 Hook。
 * 
 * 改进说明：
 * 原逻辑在任何情况下拦截返回键并执行“再按一次退出”，导致在子页面（如详情页）按系统返回键也触发退出。
 * 现增加 router.canGoBack() 检查：
 * - 如果可以回退（在子页面），则不拦截，让系统/导航器处理。
 * - 如果无法回退（在 Tab 首页），则执行“再按一次退出”逻辑。
 */
import { useCallback, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

export function useAndroidExitBack() {
  const lastBackTime = useRef(0);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        // 如果当前路由栈可以回退，则不处理，交给系统默认逻辑（即返回上一页）
        if (router.canGoBack()) {
          return false;
        }

        // 已经在根页面（Tab），执行双击退出逻辑
        const now = Date.now();
        if (now - lastBackTime.current < 2000) {
          BackHandler.exitApp();
          return true;
        }
        lastBackTime.current = now;
        ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
        return true;
      });

      return () => subscription.remove();
    }, [router])
  );
}
