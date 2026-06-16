/**
 * 全局排行榜页
 * 数据来自 Supabase app_rankings 表（由 aggregate-rankings Edge Function 聚合）
 * 支持：热门榜 / 下载榜 / 收藏榜  ×  周榜 / 月榜 / 总榜
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { supabase } from '@/client/supabase';
import { uploadPendingEvents } from '@/lib/events';

type RankType = 'hot' | 'download' | 'favorite';
type Period = 'week' | 'month' | 'all';

interface RankItem {
  app_id: number;
  app_name: string;
  owner: string;
  repo: string;
  avatar_url: string;
  score: number;
  download_count: number;
  favorite_count: number;
  view_count: number;
  rank_position: number;
}

const RANK_TABS: { key: RankType; label: string; icon: string; color: string }[] = [
  { key: 'hot',      label: '热门榜', icon: 'flame',         color: '#FF4D4F' },
  { key: 'download', label: '下载榜', icon: 'download',      color: '#1677FF' },
  { key: 'favorite', label: '收藏榜', icon: 'heart',         color: '#FF4D88' },
];

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: 'week',  label: '周榜' },
  { key: 'month', label: '月榜' },
  { key: 'all',   label: '总榜' },
];

const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

export default function RankingScreen() {
  const router = useRouter();
  const [rankType, setRankType] = useState<RankType>('hot');
  const [period, setPeriod] = useState<Period>('week');
  const [items, setItems] = useState<RankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [aggregating, setAggregating] = useState(false);

  const loadRankings = useCallback(async (type: RankType, p: Period) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('app_rankings')
        .select('app_id, app_name, owner, repo, avatar_url, score, download_count, favorite_count, view_count, rank_position, updated_at')
        .eq('rank_type', type)
        .eq('period', p)
        .order('rank_position', { ascending: true })
        .limit(50);
      if (error) throw error;
      setItems(Array.isArray(data) ? data : []);
      if (data && data.length > 0) {
        const ts = new Date((data[0] as any).updated_at);
        setLastUpdated(`更新于 ${ts.toLocaleDateString('zh-CN')} ${ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 上报本地未发送的事件
      uploadPendingEvents((name, opts) =>
        supabase.functions.invoke(name, { body: opts.body as Record<string, unknown> }).then(() => {})
      ).catch(() => {});
      loadRankings(rankType, period);
    }, [loadRankings, rankType, period])
  );

  const handleAggregateNow = async () => {
    setAggregating(true);
    try {
      await supabase.functions.invoke('aggregate-rankings', {});
      await loadRankings(rankType, period);
    } catch { /* ignore */ }
    setAggregating(false);
  };

  const handleTabChange = (type: RankType) => {
    setRankType(type);
    loadRankings(type, period);
  };
  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
    loadRankings(rankType, p);
  };

  const renderItem = ({ item, index }: { item: RankItem; index: number }) => {
    const rank = item.rank_position;
    const medal = rank <= 3 ? MEDAL_COLORS[rank - 1] : null;
    return (
      <Pressable
        android_ripple={{ color: '#F0F0F0' }}
        onPress={() => router.push(`/detail/${item.owner}/${item.repo}` as any)}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: index < items.length - 1 ? 0.5 : 0, borderBottomColor: '#F0F0F0' }}
      >
        {/* 排名 */}
        <View style={{ width: 32, alignItems: 'center' }}>
          {medal ? (
            <Ionicons name="trophy" size={20} color={medal} />
          ) : (
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#AAA' }}>{rank}</Text>
          )}
        </View>

        {/* 图标 */}
        <Image
          source={{ uri: item.avatar_url || `https://github.com/${item.owner}.png` }}
          style={{ width: 44, height: 44, borderRadius: 10, marginHorizontal: 12, backgroundColor: '#F5F5F5' }}
          contentFit="cover"
        />

        {/* 名称 + 统计 */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#1A1A1A' }} numberOfLines={1}>
            {item.app_name || item.repo}
          </Text>
          <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }} numberOfLines={1}>
            {item.owner}/{item.repo}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            {item.download_count > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Ionicons name="download-outline" size={11} color="#1677FF" />
                <Text style={{ fontSize: 11, color: '#1677FF' }}>{item.download_count}</Text>
              </View>
            )}
            {item.favorite_count > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Ionicons name="heart-outline" size={11} color="#FF4D88" />
                <Text style={{ fontSize: 11, color: '#FF4D88' }}>{item.favorite_count}</Text>
              </View>
            )}
            {item.view_count > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Ionicons name="eye-outline" size={11} color="#888" />
                <Text style={{ fontSize: 11, color: '#888' }}>{item.view_count}</Text>
              </View>
            )}
          </View>
        </View>

        {/* 热度分 */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: rankType === 'hot' ? '#FF4D4F' : rankType === 'download' ? '#1677FF' : '#FF4D88' }}>
          {item.score > 999 ? `${(item.score / 1000).toFixed(1)}k` : item.score}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F6F8' }} edges={['top']}>
      {/* 标题栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1A1A1A' }}>排行榜</Text>
        <Pressable
          onPress={handleAggregateNow}
          android_ripple={{ color: '#E8F0FF' }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#EEF4FF', borderRadius: 20 }}
        >
          {aggregating
            ? <ActivityIndicator size={13} color="#1677FF" />
            : <Ionicons name="refresh-outline" size={14} color="#1677FF" />}
          <Text style={{ fontSize: 12, color: '#1677FF' }}>刷新榜单</Text>
        </Pressable>
      </View>

      {/* 榜单类型 Tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 }}>
        {RANK_TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => handleTabChange(t.key)}
            android_ripple={{ color: '#F0F0F0' }}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              paddingVertical: 8, borderRadius: 20,
              backgroundColor: rankType === t.key ? t.color : '#fff',
              boxShadow: rankType === t.key ? [] : [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.06)' }],
            } as any}
          >
            <Ionicons name={t.icon as any} size={14} color={rankType === t.key ? '#fff' : t.color} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: rankType === t.key ? '#fff' : '#555' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* 周期 Tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', backgroundColor: '#EBEBEB', borderRadius: 20, padding: 3 }}>
          {PERIOD_TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => handlePeriodChange(t.key)}
              style={{ paddingHorizontal: 16, paddingVertical: 5, borderRadius: 16, backgroundColor: period === t.key ? '#fff' : 'transparent' }}
            >
              <Text style={{ fontSize: 13, fontWeight: period === t.key ? '600' : '400', color: period === t.key ? '#1A1A1A' : '#888' }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        {lastUpdated ? (
          <Text style={{ fontSize: 11, color: '#BBB', alignSelf: 'center', marginLeft: 'auto' }}>{lastUpdated}</Text>
        ) : null}
      </View>

      {/* 榜单列表 */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#1677FF" size="large" />
        </View>
      ) : items.length === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 40 }}>
          <Ionicons name="trophy-outline" size={60} color="#E0E0E0" />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginTop: 16, textAlign: 'center' }}>
            全局榜单正在建立中
          </Text>
          <Text style={{ fontSize: 14, color: '#888', marginTop: 8, textAlign: 'center', lineHeight: 22 }}>
            榜单基于全体用户的真实行为生成，数据越多，榜单越准确。
          </Text>

          {/* 步骤引导 */}
          <View style={{ width: '100%', marginTop: 28, gap: 12 }}>
            {[
              { step: '1', icon: 'search-outline', color: '#1677FF', bg: '#EBF3FF', title: '搜索应用', desc: '在搜索页输入关键词，每次搜索都会计入统计' },
              { step: '2', icon: 'apps-outline',   color: '#FF8C00', bg: '#FFF7E6', title: '浏览 / 收藏 / 下载', desc: '进入详情页查看、点击收藏或下载安装包' },
              { step: '3', icon: 'refresh-outline', color: '#52C41A', bg: '#F6FFED', title: '刷新榜单', desc: '点击右上角「刷新榜单」，系统聚合数据生成排行' },
            ].map((item) => (
              <View key={item.step} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: '#fff', borderRadius: 14, padding: 14, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: 'rgba(0,0,0,0.06)' }] } as any}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Ionicons name={item.icon as any} size={20} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#1677FF', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 10, color: '#fff', fontWeight: '700' }}>{item.step}</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A' }}>{item.title}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#888', marginTop: 4, lineHeight: 18 }}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable
            onPress={handleAggregateNow}
            android_ripple={{ color: '#E8F0FF' }}
            style={{ marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, backgroundColor: '#1677FF', borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            {aggregating
              ? <ActivityIndicator size={16} color="#fff" />
              : <Ionicons name="refresh-outline" size={16} color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>立即生成榜单</Text>
          </Pressable>
          <Text style={{ fontSize: 11, color: '#CCC', marginTop: 12, textAlign: 'center' }}>
            榜单数据由所有用户共同贡献，匿名统计，不涉及个人隐私
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.app_id)}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="automatic"
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); loadRankings(rankType, period); }}
          style={{ marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' }}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </SafeAreaView>
  );
}
