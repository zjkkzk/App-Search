import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import LetterAvatar from './LetterAvatar';

interface AppIconProps {
  owner?: string;
  repo?: string;
  url?: string | null;
  name: string;
  size?: number;
  className?: string;
  /** expo-image 加载优先级，榜单前几名传 "high" */
  priority?: 'low' | 'normal' | 'high';
}

/**
 * avatars.githubusercontent.com/${owner}?size=120 是 GitHub 官方 CDN 直链，
 * 无需任何 API 请求，直接构造即可。
 * 兼容处理 github.com/*.png 跳转链。
 */
function resolveAvatarUrl(url: string | null | undefined, owner: string): string | null {
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        // github.com/owner.png 跳转链 → 转为 CDN 直链
        if (url.includes('github.com') && url.endsWith('.png')) {
          const m = url.match(/github\.com\/([^/?]+)\.png/);
          if (m) return `https://avatars.githubusercontent.com/${m[1]}?size=120`;
        }
        return url;
      }
    } catch { /* invalid url, fall through */ }
  }
  if (owner) return `https://avatars.githubusercontent.com/${owner}?size=120`;
  return null;
}

export default function AppIcon({
  owner = '', url, name, size = 48, className = '', priority = 'normal',
}: AppIconProps) {
  // 纯派生计算，无 state、无 useEffect、无任何 API 请求
  // url/owner 变化时 useMemo 自动重算，不触发额外渲染
  const resolvedUrl = useMemo(() => resolveAvatarUrl(url, owner), [url, owner]);
  const [error, setError] = useState(false);

  if (!resolvedUrl || error) {
    return <LetterAvatar name={name} size={size} className={className} />;
  }

  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.24, overflow: 'hidden', backgroundColor: '#F5F5F5' }}>
      <Image
        source={{ uri: resolvedUrl }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={200}
        priority={priority}
        onError={() => setError(true)}
        cachePolicy="memory-disk"
        recyclingKey={owner || resolvedUrl}
      />
    </View>
  );
}
