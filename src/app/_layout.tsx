import { Stack } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { initToken } from '@/lib/token';
import { DownloadProvider } from '@/ctx/DownloadContext';
import "../global.css";

function ErrorFallback({ error }: { error: Error }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'red' }}>应用加载失败</Text>
      <Text style={{ marginTop: 10, color: '#666' }}>{error.message}</Text>
    </View>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error!} />;
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  useEffect(() => {
    initToken().catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <DownloadProvider>
            <StatusBar style="dark" backgroundColor="transparent" translucent />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(app)" />
            </Stack>
            <PortalHost />
          </DownloadProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
