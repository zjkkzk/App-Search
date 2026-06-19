import React, { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, Text, Pressable, Platform, BackHandler } from 'react-native';
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
  const navigation = useNavigation();
  /** 连按两次返回才退出（Android 系统返回键防误触） */
  const backPressCount = useRef(0);
  const backPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      requestAnimationFrame(() => SplashScreen.hideAsync().catch(() => {}));
    }
    initToken()
      .catch(() => {})
      .finally(() => setInitDone(true));
  }, []);

  // Android 系统返回键：标准处理模式
  // - 有页面可返回：主动调用 goBack()，return true 阻止系统默认行为
  // - 已在根页面：2s 内连按两次才调用 exitApp() 退出
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // 主动检查导航状态并执行返回（比 return false 更可靠）
      if (navigation.canGoBack()) {
        navigation.goBack();
        return true; // 告知系统"已处理"，阻止默认退出行为
      }
      // 已在根页面（Tabs）：防误触退出
      backPressCount.current += 1;
      if (backPressCount.current === 1) {
        backPressTimer.current = setTimeout(() => {
          backPressCount.current = 0;
        }, 2000);
        return true; // 拦截第一次按下
      }
      // 第二次按下：清理计数，明确退出
      if (backPressTimer.current) clearTimeout(backPressTimer.current);
      backPressCount.current = 0;
      BackHandler.exitApp(); // 明确调用退出，不依赖系统 return false 行为
      return true;
    });
    return () => {
      sub.remove();
      if (backPressTimer.current) clearTimeout(backPressTimer.current);
    };
  }, [navigation]);

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
