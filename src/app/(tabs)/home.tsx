import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAndroidExitBack } from '@/hooks/useAndroidExitBack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/client/supabase';
import type { AppItem } from '@/types';
import AppCard from '@/components/openappstore/AppCard';
import SkeletonCard from '@/components/openappstore/SkeletonCard';
import { useUpdate } from '@/ctx/UpdateContext';
import {
  TAXONOMY_CATEGORIES,
  SCENE_COLLECTIONS,
  PLATFORM_LIST,
  type SceneCollection,
} from '@/constants/catalogTaxonomy';

const ORANGE = '#FA8C16';

// ─── 数据请求 ────────────────────────────────────────────────────────────────
async function fetchApps(body: Record<string, unknown>): Promise<AppItem[]> {
  const { data, error } = await supabase.functions.invoke('search-catalog', { body });
  if (error) {
    const msg = await error?.context?.text?.().catch(() => '');
    throw new Error(msg || error.message || '加载失败');
  }
  return Array.isArray(data?.data) ? data.data : [];
}

// ─── 今日推荐组件 ─────────────────────────────────────────────────────────────
function TodaySection() {
  const router = useRouter();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const seedRef = useRef(Math.floor(Date.now() / 1000 / 3600)); // 每小时换一批

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const items = await fetchApps({
          sort: 'random', seed: seedRef.current,
          per_page: 5, _ts: Date.now(),
        });
        if (active) setApps(items);
      } catch { /* 忽略 */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []));

  const refresh = async () => {
    setLoading(true);
    seedRef.current = Date.now();
    try {
      const items = await fetchApps({
        sort: 'random', seed: seedRef.current, per_page: 5, _ts: Date.now(),
      });
      setApps(items);
    } catch { /* 忽略 */ }
    finally { setLoading(false); }
  };

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 20 }}>
      {/* 标题行 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#FFF3E0', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="sparkles" size={18} color={ORANGE} />
          </View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>今日推荐</Text>
        </View>
        <Pressable onPress={refresh} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="refresh" size={14} color="#999" />
          <Text style={{ fontSize: 13, color: '#999' }}>换一批</Text>
        </Pressable>
      </View>
      {/* 卡片横向滑动 */}
      {loading ? (
        <ActivityIndicator color={ORANGE} style={{ paddingVertical: 24 }} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {apps.map((app) => (
            <Pressable key={app.id}
              onPress={() => router.push({ pathname: `/detail/${app.id}`, params: { owner: app.owner, repo: app.repo } } as any)}
              style={{
                width: 160, backgroundColor: '#fff', borderRadius: 16, padding: 14,
                boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.07)' }],
              }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#F0F4FF',
                alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Ionicons name="logo-github" size={26} color="#1677FF" />
              </View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#1A1A1A' }} numberOfLines={1}>{app.name}</Text>
              <Text style={{ fontSize: 11, color: '#888', marginTop: 3 }} numberOfLines={2}>{app.description || app.repo}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                <Ionicons name="star" size={11} color="#FFAA00" />
                <Text style={{ fontSize: 11, color: '#AAA' }}>
                  {app.stars >= 1000 ? `${(app.stars / 1000).toFixed(1)}k` : String(app.stars)}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── 场景合集组件 ─────────────────────────────────────────────────────────────
function CollectionsSection() {
  const router = useRouter();
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#EBF3FF', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="layers" size={18} color="#1677FF" />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>场景合集</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {SCENE_COLLECTIONS.map((col: SceneCollection) => (
          <Pressable key={col.key}
            onPress={() => router.push({
              pathname: '/(tabs)/discover',
              params: { topics: col.topics.join(','), sort: col.sort },
            } as any)}
            style={{ width: '47%', backgroundColor: col.bg, borderRadius: 16, padding: 14,
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0,0,0,0.05)' }] }}>
            <Ionicons name={col.icon as any} size={24} color={col.color} style={{ marginBottom: 8 }} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A1A' }}>{col.title}</Text>
            <Text style={{ fontSize: 11, color: '#777', marginTop: 3 }}>{col.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── 平台入口组件 ─────────────────────────────────────────────────────────────
function PlatformsSection() {
  const router = useRouter();
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="phone-portrait" size={18} color="#3DDC84" />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>按平台浏览</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {PLATFORM_LIST.map((p) => (
          <Pressable key={p.key}
            onPress={() => router.push({
              pathname: '/(tabs)/discover',
              params: { platform: p.key },
            } as any)}
            style={{ alignItems: 'center', backgroundColor: p.bg, borderRadius: 16,
              paddingHorizontal: 18, paddingVertical: 14, gap: 6,
              boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0,0,0,0.05)' }] }}>
            <Ionicons name={p.icon as any} size={26} color={p.color} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#333' }}>{p.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── 最新发布组件 ─────────────────────────────────────────────────────────────
function LatestSection() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (p: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (p === 1) setLoading(true); else setLoadingMore(true);
    try {
      const items = await fetchApps({ sort: 'updated', page: p, per_page: 10, _ts: Date.now() });
      if (p === 1) setApps(items); else setApps((prev) => [...prev, ...items]);
      setHasMore(items.length === 10);
    } catch { /* 忽略 */ }
    finally {
      setLoading(false);
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setPage(1);
    load(1);
  }, [load]));

  const loadMore = () => {
    if (!loadingRef.current && hasMore) {
      const n = page + 1;
      setPage(n);
      load(n);
    }
  };

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="time" size={18} color="#00897B" />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>最新发布</Text>
      </View>
      {loading ? (
        <View>{[1,2,3].map((i) => <SkeletonCard key={i} />)}</View>
      ) : (
        <>
          {apps.map((app) => <AppCard key={app.id} app={app} />)}
          {loadingMore && <ActivityIndicator color="#1677FF" style={{ paddingVertical: 12 }} />}
          {hasMore && !loadingMore && (
            <Pressable onPress={loadMore}
              style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: '#1677FF', fontSize: 13 }}>加载更多</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

// ─── 分类宫格组件 ─────────────────────────────────────────────────────────────
function CategoryGrid() {
  const router = useRouter();
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: '#F3E5F5', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="grid" size={18} color="#9C27B0" />
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>按类型发现</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {TAXONOMY_CATEGORIES.map((cat) => (
          <Pressable key={cat.key}
            onPress={() => router.push({
              pathname: '/(tabs)/discover',
              params: { topics: cat.topics.join(',') },
            } as any)}
            style={{ width: '25%', alignItems: 'center', paddingVertical: 10, gap: 6 }}>
            <View style={{ width: 52, height: 52, borderRadius: 15, backgroundColor: cat.bg,
              alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={cat.icon as any} size={24} color={cat.color} />
            </View>
            <Text style={{ fontSize: 11, color: '#555', textAlign: 'center' }}>{cat.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function HomeTab() {
  const router = useRouter();
  const { pendingCount } = useUpdate();
  useAndroidExitBack();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F6F8' }} edges={['top']}>
      <FlatList
        data={[1]}   // 单条占位，内容全部在 ListHeaderComponent 里
        keyExtractor={() => 'main'}
        renderItem={() => null}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            {/* 搜索栏 + 通知 + 头像 */}
            <View style={{ flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 8 }}>
              <Pressable
                onPress={() => router.push('/(tabs)/search' as any)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
                  borderRadius: 24, paddingHorizontal: 14, paddingVertical: 11, gap: 6,
                  boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.06)' }] }}>
                <Ionicons name="search-outline" size={16} color="#AAAAAA" />
                <Text style={{ color: '#AAAAAA', fontSize: 14 }}>搜索开源应用…</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/downloads' as any, params: { tab: 'installed' } })}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
                  alignItems: 'center', justifyContent: 'center',
                  boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.06)' }] }}>
                <Ionicons name="notifications-outline" size={20} color={pendingCount > 0 ? ORANGE : '#555'} />
                {pendingCount > 0 && (
                  <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16,
                    borderRadius: 8, backgroundColor: '#FF4D4F', alignItems: 'center',
                    justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff' }}>
                    <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700', lineHeight: 11 }}>
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </Text>
                  </View>
                )}
              </Pressable>
              <Pressable
                onPress={() => router.push('/(tabs)/profile' as any)}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#EBF3FF',
                  alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#1677FF' }}>
                <Ionicons name="logo-github" size={20} color="#1677FF" />
              </Pressable>
            </View>

            {/* 标语 */}
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#1A1A1A' }}>开源应用商店</Text>
              <Text style={{ fontSize: 13, color: '#888', marginTop: 3 }}>发现可安装 · 可信赖 · 正在流行的开源应用</Text>
            </View>

            {/* 各内容区块 */}
            <TodaySection />
            <CollectionsSection />
            <PlatformsSection />
            <CategoryGrid />
            <LatestSection />
          </View>
        }
      />
    </SafeAreaView>
  );
}
