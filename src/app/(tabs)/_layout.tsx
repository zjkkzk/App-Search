import React, { useCallback, useRef } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, BackHandler, ToastAndroid } from 'react-native';

const TAB_HEIGHT = Platform.OS === 'ios' ? 64 : 60;
const TAB_PADDING_BOTTOM = Platform.OS === 'ios' ? 10 : 6;

export default function TabsLayout() {
  const lastBackTime = useRef(0);

  // useFocusEffect 确保 handler 仅在 Tabs 处于最顶层时激活。
  // 当子页面（detail/downloads 等）叠加在上方时，Tabs 失去焦点，handler 自动移除，
  // 子页面按返回由原生 Stack 处理，完全不干扰。
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
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1677FF',
        tabBarInactiveTintColor: '#999999',
        tabBarStyle: {
          height: TAB_HEIGHT,
          paddingBottom: TAB_PADDING_BOTTOM,
          paddingTop: 4,
          borderTopWidth: 0.5,
          borderTopColor: '#E8E8E8',
          backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.92)' : '#FFFFFF',
        },
        tabBarHideOnKeyboard: true,
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: '首页', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="discover" options={{ title: '发现', tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="ranking" options={{ title: '榜单', tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: '搜索', tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: '我的', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}
