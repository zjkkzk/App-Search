/**
 * useAndroidExitBack
 *
 * Tab 根页面专用：Android 硬件返回键「再按一次退出应用」。
 * 使用 useFocusEffect + BackHandler 确保只有当前聚焦的页面响应返回键，
 * 失焦（切换 Tab / 进入子页面）时自动注销监听，避免多页面冲突。
 */
import { useCallback, useRef } from 'react';
import { BackHandler, ToastAndroid, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function useAndroidExitBack() {
  const lastBackTime = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const now = Date.now();
        if (now - lastBackTime.current < 2000) {
          BackHandler.exitApp();
          return true;
        }
        lastBackTime.current = now;
        ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
        return true;
      });

      return () => {
        sub.remove();
        lastBackTime.current = 0;
      };
    }, [])
  );
}
