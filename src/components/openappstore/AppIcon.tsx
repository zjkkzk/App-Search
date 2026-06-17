import React, { useState, useMemo, useEffect } from 'react';
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
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function ensureAvatarUrl(url: string | null | undefined, owner: string): string | null {
  if (url && isValidHttpUrl(url)) {
    // 将 github.com/*.png 重定向链替换为 CDN 直链，避免部分浏览器拦截跨域跳转
    if (url.includes('github.com') && url.endsWith('.png')) {
      const match = url.match(/github\.com\/([^/?]+)\.png/);
      if (match) return `https://avatars.githubusercontent.com/${match[1]}?size=120`;
    }
    return url;
  }
  // 直接使用 avatars.githubusercontent.com CDN（无重定向，兼容所有浏览器）
  if (owner) return `https://avatars.githubusercontent.com/${owner}?size=120`;
  return null;
}

export default function AppIcon({ owner = '', url, name, size = 48, className = '' }: AppIconProps) {
  const finalUrl = useMemo(() => ensureAvatarUrl(url, owner), [url, owner]);
  const [error, setError] = useState(false);

  // finalUrl 变化时重置错误状态，防止旧的失败状态阻止新 URL 加载
  useEffect(() => { setError(false); }, [finalUrl]);

  if (!finalUrl || error) {
    return <LetterAvatar name={name} size={size} className={className} />;
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        overflow: 'hidden',
        backgroundColor: '#F5F5F5',
      }}
    >
      <Image
        source={{ uri: finalUrl }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={200}
        onError={() => setError(true)}
        cachePolicy="memory-disk"
      />
    </View>
  );
}
