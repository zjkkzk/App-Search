/**
 * useAndroidGoBack
 *
 * 子页面专用：Android 硬件返回键调用 router.back() 返回上一页。
 * 使用 useFocusEffect + BackHandler 确保只有当前聚焦的子页面响应返回键，
 * 失焦时自动注销监听，避免多页面冲突。
 */
import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect, router } from 'expo-router';

export function useAndroidGoBack() {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.back();
        return true;
      });

      return () => sub.remove();
    }, [])
  );
}
