/**
 * useAndroidExitBack
 *
 * 专为 Tab 屏幕设计的 Android 返回键 Hook。
 * 原理：
 *   - expo-router v55 使用 native-stack（基于 react-native-screens Fragment 堆栈），
 *     子页面（detail/downloads 等）的返回由 Android Fragment Manager 在原生层处理，
 *     不经过 JS BackHandler。
 *   - Tab 屏幕是真正的 React Navigation Screen，当子页面压入 Stack 时，Tab 屏幕触发
 *     blur，useFocusEffect cleanup 自动移除 BackHandler；返回 Tab 时重新注册。
 *   - 只需在每个 Tab 屏幕组件顶层调用此 Hook，无需任何参数。
 *
 * 行为：
 *   - 第一次按返回：Toast 提示"再按一次退出应用"
 *   - 2 秒内再次按返回：调用 BackHandler.exitApp() 退出
 */
import { useCallback, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function useAndroidExitBack() {
  const lastBackTime = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
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
    }, [])
  );
}
