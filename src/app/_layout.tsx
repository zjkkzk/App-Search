import { Stack } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DownloadProvider } from '@/ctx/DownloadContext';
import "../global.css";

export default function RootLayout() {
  useEffect(() => {
    import('@/lib/token')
      .then((mod) => mod.initToken())
      .catch((e: any) => console.warn('[RootLayout] initToken failed:', e?.message));
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider style={{ flex: 1 }}>
        <DownloadProvider>
          <StatusBar style="dark" backgroundColor="transparent" translucent />
          <Stack
            initialRouteName="(tabs)"
            screenOptions={{ headerShown: false, animation: 'none' }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="detail" />
            <Stack.Screen name="downloads" />
            <Stack.Screen name="favorites" />
            <Stack.Screen name="search-history" />
          </Stack>
          <PortalHost />
        </DownloadProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
