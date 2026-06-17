import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { addSearchHistory, clearSearchHistory, getSearchHistory } from '@/lib/database';
import { addAppEvent } from '@/lib/events';
import { searchRepos } from '@/lib/github';
import type { AppItem } from '@/types';
import AppCard from '@/components/openappstore/AppCard';

const BLOCKED_PATTERNS = [
  /è‰²æƒ…|è£¸ä½“|é»„ç‰‡|æˆäººç‰‡|æº¦ç‚°|å«–å¨¼/i,
  /\b(porn|nude|xxx|sex(?:ual)?|av\b)/i,
  /èµŒåš|èµŒåœº|åšå½©/i,
  /æ¯’å“|å¤§éº»|å†°æ¯’|æµ—æ´›å› |å¯å¡å› /i,
  /\b(drug|weed|cocaine)\b/i,
  /ç‚¸å¼¹|æž¹¦”¯|æš—ç½‘|æ€äººæ•™ç¨‹/i,
];
function isSafeKeyword(kw: string): boolean {
  return !BLOCKED_PATTERNS.some((re) => re.test(kw));
}

export default function SearchTab() {
  const inputRef = useRef<TextInput>(null);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hotWords, setHotWords] = useState<string[]>([]);
  const [results, setResults] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [searchSource, setSearchSource] = useState<'init' | 'local' | 'remote' | 'hybrid'>('init');
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const lastKeywordRef = useRef('');

  const loadHistory = useCallback(async () => {
    try { setHistory(await getSearchHistory()); } catch { /* ignore */ }
  }, []);

  const loadHotWords = useCallback(async () => {
    try {
      const { getPopularKeywords } = await import('@/lib/events');
      const kws = await getPopularKeywords(20);
      if (kws.length > 0) {
        setHotWords(kws.map((k) => k.keyword).filter(isSafeKeyword));
      }
    } catch { /* é™é»˜å¤±è´¥ */ }
  }, []);

  useFocusEffect(useCallback(() => {
    loadHistory();
    loadHotWords();
  }, [loadHistory, loadHotWords]));

  /**
   * æ ¸å¿ƒæœç´¢ï¼šæœ¬åœ°å…ˆç“è€” â†’ GitHub è¿œç¨‹æœç´¢ï¼ˆå®‰è£…åŒ…é¡¹ç›®è¿‡æ»¤ï¼‰
   */
  const performSearch = async (kw: string, pageNum = 1, isLoadMore = false) => {
    const k = kw.trim();
    if (!k) return;
    if (!isLoadMore && loadingRef.current) return;

    if (!isSafeKeyword(k)) {
      setSearched(true);
      setLoading(false);
      setError('æœç´¢å†…å®¹åŒ…å«ä¸å®‰å…¨ç›µåŠ›');
      setResults([]);
      return;
    }

    inputRef.current?.blur();

    if (!isLoadMore) {
      try { addSearchHistory(k).then(loadHistory); } catch { /* ignore */ }
      addAppEvent({ event_type: 'search', keyword: k }).catch(() => {});

      lastKeywordRef.current = k;
      setSearched(true);
      setLoading(true);
      setError('');
      setResults([]);
      setPage(1);
      setHasMore(false);
      setTotalCount(0);
      setSearchSource('init');

    } else {
      setLoadingMore(true);
    }

    // ç¬¬äºŒæ­¥ï¼šè¿œç¨‹æœç´¢ï¼ˆå¾Šæ´¥ï¼ŒinstallableOnly=trueï¼‰
    try {
      const result = await searchRepos(k, {
        sort: 'stars',
        order: 'desc',
        page: pageNum,
        per_page: 20,
        installableOnly: true,
      });

      if (!isLoadMore) {
        setResults(result.items);
        setSearchSource(result.items.length > 0 ? 'remote' : 'local');
        setTotalCount(result.total_count);
        setHasMore(result.items.length >= 20 && result.items.length < result.total_count);
        setError('');
      } else {
        setResults((prev) => [...prev, ...result.items]);
        setHasMore(results.length + result.items.length < result.total_count);
      }
      setPage(pageNum);
    } catch (e: any) {
      console.warn('[Search] Remote search failed:', e?.message || e);
      if (!isLoadMore) {
        if (results.length === 0) {
          setError('è¿œç¨‹æœç´¢æš‚ä¸å¯ç”¨ï¼š' + (e?.message || 'ç½‘ç»œé”™è¯¯ï¼Œè¯·æ£€æŸ¥åŽç«¯æœåŠ¡ï¼š'));
        }
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingRef.current = false;
    }
  };

  const handleLoadMore = () => {
    if (loadingRef.current || !hasMore || loadingMore) return;
    loadingRef.current = true;
    performSearch(lastKeywordRef.current, page + 1, true);
  };

  const clearInput = () => { setInputValue(''); };
  const handleCancel = () => {
    clearInput();
    setSearched(false);
    setResults([]);
    setError('');
    setPage(1);
    setHasMore(false);
    setTotalCount(0);
    setSearchSource('init');
    lastKeywordRef.current = '';
  };
  const tagStyle = { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, borderWidth: 1, borderColor: '#E8E8E8', backgroundColor: '#fff' } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, height: 40, gap: 6 }}>
          <Ionicons name="search-outline" size={16} color="#AAA" />
          <TextInput
            ref={inputRef}
            style={{ flex: 1, fontSize: 15, color: '#1A1A1A' } as any}
            placeholder="æœç´¢å…¨éƒ¨GitHubå¼€æºé¡¹ç›®â€¦"
            placeholderTextColor="#AAA"
            value={inputValue}
            onChangeText={setInputValue}
            onSubmitEditing={(e) => performSearch(e.nativeEvent.text || inputValue)}
            returnKeyType="search"
            underlineColorAndroid="transparent"
          />
          {inputValue.length > 0 && (
            <Pressable onPress={clearInput} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color="#AAA" />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => performSearch(inputValue)}
          style={{ backgroundColor: '#1677FF', borderRadius: 10, height: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>æœç´¢</Text>
        </Pressable>
        {searched && (
          <Pressable onPress={handleCancel} hitSlop={8}>
            <Text style={{ color: '#1677FF', fontSize: 15 }}>å–æ¶ˆ</Text>
          </Pressable>
        )}
      </View>

      {!searched ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 20 }}>
          {history.length > 0 && (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', fontSize: 15 }}>æœç´¢åŽ†å²</Text>
                <Pressable onPress={async () => { await clearSearchHistory(); setHistory([]); }}>
                  <Text style={{ color: '#999', fontSize: 13 }}>æ¸…ç©º</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {history.map((h) => (
                  <Pressable key={h} onPress={() => performSearch(h)} style={tagStyle}>
                    <Text style={{ fontSize: 13, color: '#333' }}>{h}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontWeight: '700', fontSize: 15 }}>çƒ­é—¨æœç´¢</Text>
              <Ionicons name="flame" size={14} color="#FF4D00" />
            </View>
            {hotWords.length === 0 ? (
              <Text style={{ fontSize: 13, color: '#BBB' }}>æš‚æ— çƒ­æœæ•°æ®</Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {hotWords.map((h) => (
                  <Pressable key={h} onPress={() => performSearch(h)} style={tagStyle}>
                    <Text style={{ fontSize: 13, color: '#333' }}>{h}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : loading && results.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#1677FF" size="large" />
        </View>
      ) : error && results.length === 0 ? (
        <View style={{ margin: 16, padding: 16, borderRadius: 12, backgroundColor: '#FFF2F0', borderWidth: 1, borderColor: '#FFCCC7' }}>
          <Text style={{ color: '#d32f2f', fontSize: 14 }}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <AppCard app={item} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#888' }}>
                  å…±æ‰¾åˆ° {totalCount > 0 ? totalCount : results.length} ä¸ªåº”ç”¨
                </Text>
                {searchSource === 'remote' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="cloud-done-outline" size={12} color="#52C41A" />
                    <Text style={{ fontSize: 11, color: '#52C41A' }}>GitHub</Text>
                  </View>
                )}
                {searchSource === 'local' && (!loading || results.length > 0) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="phone-portrait-outline" size={12} color="#FAAD14" />
                    <Text style={{ fontSize: 11, color: '#FAAD14' }}>æœ¬åœ°</Text>
                  </View>
                )}
              </View>
              {searchSource === 'local' && loading && results.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <ActivityIndicator size={10} color="#1677FF" />
                  <Text style={{ fontSize: 11, color: '#1677FF' }}>æ­£åœ¨ä»ŽGitHubèŽ·å–æœ€æ–°ç»“æžœâ€¦</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 8 }}>
              <Ionicons name="search-outline" size={48} color="#CCC" />
              <Text style={{ color: '#888', fontSize: 15, fontWeight: '600' }}>
                æœªæ‰¾åˆ°ç›¸å…³åº”ç”¨
              </Text>
              <Text style={{ color: '#BBB', fontSize: 13 }}>
                ä»…å±•ç¤ºæœ‰å®‰è£…åŒ…çš„GitHubå¼€æºé¡¹ç›®ï¼Œç¨‹è¯•å…¶ä»–å…³é”®è¯
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator color="#1677FF" />
              </View>
            ) : hasMore ? (
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ color: '#BBB', fontSize: 12 }}>ä¸Šæ»‘åŠ è½½æ›´å¤š</Text>
              </View>
            ) : results.length > 0 ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ color: '#CCC', fontSize: 12 }}>â€” å·²æ˜¾ç¤ºå…¨éƒ¨ç»“æžœ â€”</Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}