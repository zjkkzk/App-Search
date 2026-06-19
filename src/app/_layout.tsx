import React, { useEffect, useRef, useState } from 'react';
import { Stack, useNavigationContainerRef } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Platform, ToastAndroid, View, Text, Pressable } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { initToken } from '@/lib/token';
import { DownloadProvider } from '@/ctx/DownloadContext';
import AppSplash from '@/components/AppSplash';
import "../global.css";

// 仅在 Native 端阻止启动屏自动隐藏（Web 端该 API 是空操作，不会出错）
if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

/** 全局错误边界：捕获任何渲染错误，显示可见提示而非白屏 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: any) {
    return { error: e?.message || String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#d32f2f', marginBottom: 12 }}>
            应用启动出错
          </Text>
          <Text style={{ fontSize: 13, color: '#555', textAlign: 'center', marginBottom: 20 }}>
            {this.state.error}
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: '#1677FF', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>重试</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const [initDone, setInitDone] = useState(false);
  const [showSplash, setShowSplash] = useState(Platform.OS !== 'web');
  // useNavigationContainerRef 可读取整个导航树的真实状态，
  // 比 useRouter().canGoBack() 更准确（后者在根布局中可能错误返回 false）
  const navigationRef = useNavigationContainerRef();
  const lastBackTime = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      requestAnimationFrame(() => SplashScreen.hideAsync().catch(() => {}));
    }
    initToken()
      .catch(() => {})
      .finally(() => setInitDone(true));
  }, []);

  // 集中式 Android 返回键处理（单一 handler，无 focus 竞争）：
  //   根 Stack routes.length > 1 → 子页面在顶部 → return false 透传给原生 Fragment
  //   根 Stack routes.length = 1 → 在 Tab 根页面 → 拦截，双击退出
  //
  //   用 getState().routes.length 而非 canGoBack()，因为后者在根布局中行为不一致：
  //   canGoBack() 依赖 navigator 内部状态，在根布局中可能错误返回 false。
  //   getState() 直接读取导航树快照，routes.length 精确反映当前栈深度。
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = navigationRef.getState?.();
      // 根 Stack 有超过 1 条路由 → 子页面（detail/downloads/favorites/search-history）在顶部
      // 返回 false：事件透传给原生 OnBackPressedDispatcher，由 React Navigation 弹出路由
      if ((state?.routes?.length ?? 0) > 1) {
        return false;
      }
      // routes.length === 1：用户在 Tab 根页面，拦截并处理退出逻辑
      const now = Date.now();
      if (now - lastBackTime.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBackTime.current = now;
      ToastAndroid.show('再按一次退出应用', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  // navigationRef 是稳定引用，仅注册一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ErrorBoundary>
      <DownloadProvider>
        <SafeAreaProvider style={{ flex: 1 }}>
          <StatusBar style="dark" backgroundColor="transparent" translucent={Platform.OS === 'android'} />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: Platform.OS === 'android' ? 'fade_from_bottom' : Platform.OS === 'ios' ? 'default' : 'none',
              gestureEnabled: true,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
            <Stack.Screen name="detail" />
            <Stack.Screen name="downloads" />
            <Stack.Screen name="favorites" />
            <Stack.Screen name="search-history" />
            <Stack.Screen name="+not-found" />
          </Stack>
        </SafeAreaProvider>
        {/* AppSplash 自管最短展示时长(1.8s) + 淡出动画，结束后自行卸载 */}
        {showSplash && (
          <AppSplash
            initDone={initDone}
            onHidden={() => setShowSplash(false)}
          />
        )}
      </DownloadProvider>
    </ErrorBoundary>
  );
}
