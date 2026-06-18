/**
 * 应用内通知模块（纯 JS，无原生依赖）
 *
 * 使用 React Context 在应用顶部显示横幅通知：
 * - 下载进行中：进度通知
 * - 下载完成：绿色成功横幅（自动消失 3s）
 * - 下载失败：红色错误横幅（自动消失 5s）
 *
 * 架构：通过 NotificationProvider 包裹根组件，Other 组件通过 useNotification() 调用 show()
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, Animated, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ─── 类型 ────────────────────────────────────────────────────────────────────
export type NotifType = 'info' | 'success' | 'error' | 'progress';
export interface NotifPayload {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  progress?: number; // 0~1
  action?: { label: string; onPress: () => void };
  duration?: number; // ms，0 表示不自动消失
}

interface NotificationContextValue {
  show: (payload: Omit<NotifPayload, 'id'>) => string;
  update: (id: string, payload: Partial<Omit<NotifPayload, 'id'>>) => void;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<NotifPayload[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const show = useCallback((payload: Omit<NotifPayload, 'id'>): string => {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const item: NotifPayload = { ...payload, id };
    setItems((prev) => [...prev, item]);

    const dur = payload.duration ?? (payload.type === 'progress' ? 0 : payload.type === 'error' ? 5000 : 3000);
    if (dur > 0) {
      const timer = setTimeout(() => dismiss(id), dur);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const update = useCallback((id: string, payload: Partial<Omit<NotifPayload, 'id'>>) => {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, ...payload } : n));
  }, []);

  const ctx: NotificationContextValue = { show, update, dismiss };

  return (
    <NotificationContext.Provider value={ctx}>
      {children}
      {/* 通知横幅层 */}
      <View style={styles.container} pointerEvents="box-none">
        {items.map((n) => (
          <NotificationBanner key={n.id} payload={n} onDismiss={() => dismiss(n.id)} />
        ))}
      </View>
    </NotificationContext.Provider>
  );
}

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used inside <NotificationProvider>');
  return ctx;
}

// ─── 横幅组件 ─────────────────────────────────────────────────────────────────
function NotificationBanner({ payload, onDismiss }: { payload: NotifPayload; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);

  const { type, title, body, progress, action } = payload;
  const isProgress = type === 'progress';
  const bgColor = type === 'error' ? '#FFF1F0' : type === 'success' ? '#F6FFED' : '#E6F7FF';
  const borderColor = type === 'error' ? '#FF4D4F' : type === 'success' ? '#52C41A' : '#1677FF';
  const iconName = type === 'error' ? 'alert-circle' : type === 'success' ? 'checkmark-circle' : 'information-circle';

  return (
    <Animated.View style={[styles.banner, { backgroundColor: bgColor, borderLeftColor: borderColor, opacity }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 }}>
        <Ionicons name={iconName as any} size={20} color={borderColor} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontWeight: '600', fontSize: 14, color: '#1A1A1A' }} numberOfLines={1}>{title}</Text>
          <Text style={{ fontSize: 12, color: '#666' }} numberOfLines={2}>{body}</Text>
          {isProgress && progress !== undefined && (
            <View style={{ height: 3, backgroundColor: '#E5E5E5', borderRadius: 2, marginTop: 4 }}>
              <View style={{ height: 3, backgroundColor: borderColor, borderRadius: 2, width: `${Math.round(progress * 100)}%` as any }} />
            </View>
          )}
          {action && (
            <Pressable onPress={action.onPress} style={{ alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: borderColor }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{action.label}</Text>
            </Pressable>
          )}
        </View>
        <Pressable onPress={onDismiss} hitSlop={8} style={{ padding: 2 }}>
          <Ionicons name="close" size={16} color="#999" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 12,
    right: 12,
    zIndex: 9999,
    gap: 8,
  },
  banner: {
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
});