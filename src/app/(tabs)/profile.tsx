import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { saveToken, getToken, clearToken } from '@/lib/token';
import {
  getFavoriteStats,
  getDownloadHistory,
  getSearchHistory,
  clearDownloadHistory,
  clearSearchHistory,
} from '@/lib/database';
import { fetchRateLimit } from '@/lib/github';

const APP_VERSION = '1.0.0';
const REPO_URL = 'https://github.com/qq5855144/App-Search';

// 跨端确认弹窗：原生用 Alert，Web 用 confirm
function confirmDialog(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`),
    );
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: '取消', style: 'cancel', onPress: () => resolve(false) },
      { text: '确定', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function ProfileTab() {
  const router = useRouter();
  const [token, setTokenState] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rateLimit, setRateLimit] = useState({ remaining: 60, limit: 60, reset: 0 });
  const [favCount, setFavCount] = useState(0);
  const [downloadCount, setDownloadCount] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, favStats, downloads, searches] = await Promise.all([
        getToken(),
        getFavoriteStats(),
        getDownloadHistory().catch(() => []),
        getSearchHistory().catch(() => []),
      ]);
      if (t) {
        setTokenState(t);
        setSaved(true);
      } else {
        setTokenState('');
        setSaved(false);
      }
      setFavCount(favStats.total);
      setDownloadCount(downloads.length);
      setSearchCount(searches.length);
      // API 配额属于次要信息，失败不影响其他统计
      fetchRateLimit().then(setRateLimit).catch(() => {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const handleSave = async () => {
    const t = token.trim();
    if (t.length < 10 || saving) return;
    setSaving(true);
    try {
      await saveToken(t);
      setSaved(true);
      fetchRateLimit().then(setRateLimit).catch(() => {});
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    const ok = await confirmDialog('清除 Token', '清除后 API 请求上限会回到每小时 60 次');
    if (!ok) return;
    await clearToken();
    setTokenState('');
    setSaved(false);
    setRateLimit({ remaining: 60, limit: 60, reset: 0 });
  };

  const handleClearDownloads = async () => {
    if (downloadCount === 0) return;
    const ok = await confirmDialog('清空下载记录', '此操作不可恢复');
    if (!ok) return;
    await clearDownloadHistory();
    setDownloadCount(0);
  };

  const handleClearSearches = async () => {
    if (searchCount === 0) return;
    const ok = await confirmDialog('清空搜索历史', '此操作不可恢复');
    if (!ok) return;
    await clearSearchHistory();
    setSearchCount(0);
  };

  const handleOpenRepo = () => {
    Linking.openURL(REPO_URL).catch(() => {});
  };

  const ratePct = rateLimit.limit > 0 ? rateLimit.remaining / rateLimit.limit : 0;
  const rateColor = ratePct > 0.5 ? '#52c41a' : ratePct > 0.2 ? '#faad14' : '#f5222d';
  const resetText = rateLimit.reset
    ? new Date(rateLimit.reset * 1000).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--:--';

  if (loading) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: '#F5F6F8',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        edges={['top']}
      >
        <ActivityIndicator color="#1677FF" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F6F8' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* 标题 */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1A1A1A' }}>我的</Text>
          <Text style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            管理收藏、下载、搜索历史与 GitHub Token
          </Text>
        </View>

        {/* 统计卡片 */}
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: 16,
            gap: 10,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <StatCard
            label="收藏应用"
            value={String(favCount)}
            icon="heart-outline"
            color="#FF4D88"
            onPress={() => router.push('/favorites' as any)}
          />
          <StatCard
            label="下载记录"
            value={String(downloadCount)}
            icon="download-outline"
            color="#1677FF"
            onPress={() => router.push('/downloads' as any)}
          />
          <StatCard
            label="搜索历史"
            value={String(searchCount)}
            icon="time-outline"
            color="#722ED1"
            onPress={() => router.push('/search-history' as any)}
          />
          <StatCard
            label={`API 配额 · 重置 ${resetText}`}
            value={`${rateLimit.remaining}/${rateLimit.limit}`}
            icon="flash-outline"
            color={rateColor}
          />
        </View>

        {/* 功能入口 */}
        <SectionCard title="功能">
          <FeatureRow
            icon="heart-outline"
            color="#FF4D88"
            title="我的收藏"
            subtitle={`${favCount} 个应用`}
            onPress={() => router.push('/favorites' as any)}
          />
          <Divider />
          <FeatureRow
            icon="download-outline"
            color="#1677FF"
            title="下载记录"
            subtitle={`${downloadCount} 条记录`}
            onPress={() => router.push('/downloads' as any)}
            extra={
              downloadCount > 0 ? (
                <Pressable onPress={handleClearDownloads} hitSlop={8}>
                  <Text style={{ color: '#f5222d', fontSize: 13 }}>清空</Text>
                </Pressable>
              ) : null
            }
          />
          <Divider />
          <FeatureRow
            icon="time-outline"
            color="#722ED1"
            title="搜索历史"
            subtitle={`${searchCount} 条记录`}
            onPress={() => router.push('/search-history' as any)}
            extra={
              searchCount > 0 ? (
                <Pressable onPress={handleClearSearches} hitSlop={8}>
                  <Text style={{ color: '#f5222d', fontSize: 13 }}>清空</Text>
                </Pressable>
              ) : null
            }
          />
        </SectionCard>

        {/* Token 设置 */}
        <View
          style={{
            marginHorizontal: 16,
            backgroundColor: '#fff',
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Ionicons name="key-outline" size={18} color="#1677FF" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>GitHub Token</Text>
            {saved && (
              <View
                style={{
                  marginLeft: 4,
                  backgroundColor: '#F6FFED',
                  borderRadius: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderWidth: 1,
                  borderColor: '#B7EB8F',
                }}
              >
                <Text style={{ fontSize: 11, color: '#52C41A' }}>已配置</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 13, color: '#888', marginBottom: 12, lineHeight: 18 }}>
            配置 Personal Access Token 可将 API 请求上限从每小时 60 次提升至 5000 次，
            Token 仅保存在本地（移动端使用安全存储，Web 使用 localStorage）
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#F7F7F7',
              borderRadius: 10,
              paddingHorizontal: 12,
              height: 44,
              marginBottom: 12,
            }}
          >
            <TextInput
              style={{ flex: 1, fontSize: 14, color: '#1A1A1A' } as any}
              value={token}
              onChangeText={setTokenState}
              placeholder="github_pat_..."
              placeholderTextColor="#BBB"
              secureTextEntry={!showToken}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={() => setShowToken((v) => !v)} hitSlop={8}>
              <Ionicons
                name={showToken ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color="#AAA"
              />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={handleSave}
              disabled={token.trim().length < 10 || saving}
              style={{
                flex: 1,
                height: 42,
                borderRadius: 10,
                backgroundColor: token.trim().length >= 10 ? '#1677FF' : '#E0E0E0',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '600' }}>保存 Token</Text>
              )}
            </Pressable>
            {saved && (
              <Pressable
                onPress={handleClear}
                style={{
                  height: 42,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: '#FFB3B3',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#f5222d', fontSize: 14 }}>清除</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => Linking.openURL('https://github.com/settings/tokens?type=beta')}
            hitSlop={8}
            style={{ marginTop: 10 }}
          >
            <Text style={{ color: '#1677FF', fontSize: 13 }}>前往 GitHub 创建 Token</Text>
          </Pressable>
        </View>

        {/* 关于 */}
        <SectionCard title="关于">
          <InfoRow label="应用版本" value={APP_VERSION} />
          <Divider />
          <InfoRow label="数据来源" value="GitHub API" />
          <Divider />
          <InfoRow label="运行平台" value={Platform.OS} />
          <Divider />
          <FeatureRow
            icon="logo-github"
            color="#1A1A1A"
            title="项目仓库"
            subtitle={REPO_URL}
            onPress={handleOpenRepo}
          />
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
  onPress,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress?: () => void;
}) {
  const Container: any = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
      style={{
        width: '48%',
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 14,
        gap: 6,
        alignItems: 'center',
      }}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={{ fontSize: 18, fontWeight: '700', color: '#1A1A1A' }}>{value}</Text>
      <Text style={{ fontSize: 12, color: '#888' }} numberOfLines={1}>
        {label}
      </Text>
    </Container>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 16,
        backgroundColor: '#fff',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 4,
        marginBottom: 16,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: '700',
          color: '#1A1A1A',
          paddingTop: 14,
          paddingBottom: 8,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function FeatureRow({
  icon,
  color,
  title,
  subtitle,
  onPress,
  extra,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: color + '1A',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: '#1A1A1A', fontWeight: '500' }}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {extra ?? <Ionicons name="chevron-forward" size={18} color="#CCC" />}
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: '#555', fontSize: 14 }}>{label}</Text>
      <Text style={{ color: '#1A1A1A', fontSize: 14, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={{ height: 0.5, backgroundColor: '#F0F0F0' }} />;
}
