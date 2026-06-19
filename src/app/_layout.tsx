import React, { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, Text, Pressable, Platform, BackHandler, Animated } from 'react-native';
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
  const backPressCount = useRef(0);
  const backPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 退出提示 Toast
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showExitToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }, 1800);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') {
      requestAnimationFrame(() => SplashScreen.hideAsync().catch(() => {}));
    }
    initToken()
      .catch(() => {})
      .finally(() => setInitDone(true));
  }, []);

  // Android 系统返回键标准处理
  // - 有页面可返回：主动 goBack()
  // - 已在根页面：第一次显示"再按一次退出"Toast，2s 内再按才 exitApp()
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation.canGoBack()) {
        navigation.goBack();
        return true;
      }
      backPressCount.current += 1;
      if (backPressCount.current === 1) {
        showExitToast();
        backPressTimer.current = setTimeout(() => {
          backPressCount.current = 0;
        }, 2000);
        return true;
      }
      if (backPressTimer.current) clearTimeout(backPressTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      backPressCount.current = 0;
      BackHandler.exitApp();
      return true;
    });
    return () => {
      sub.remove();
      if (backPressTimer.current) clearTimeout(backPressTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {/* Android 退出提示 Toast（绝对定位，叠在所有内容上方） */}
        {Platform.OS === 'android' && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: 60,
              left: 0,
              right: 0,
              alignItems: 'center',
              opacity: toastOpacity,
            }}
          >
            <View style={{
              backgroundColor: 'rgba(0,0,0,0.75)',
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 24,
            }}>
              <Text style={{ color: '#fff', fontSize: 14 }}>再按一次退出应用</Text>
            </View>
          </Animated.View>
        )}
      </DownloadProvider>
    </ErrorBoundary>
  );
}
