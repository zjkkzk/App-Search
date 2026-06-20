/**
 * TranslatedText
 * 当翻译功能开启时，自动翻译内容；否则直接渲染原文。
 * 进入视口时（组件 mount）触发翻译，滚动进来的新元素也会自动翻译。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text, TextProps } from 'react-native';
import { useTranslation } from '@/ctx/TranslationContext';

interface TranslatedTextProps extends TextProps {
  children: string;
  /** 原文语言提示，用于判断是否需要翻译（默认：非目标语言时翻译） */
  srcLang?: string;
}

export default function TranslatedText({ children, srcLang, style, ...props }: TranslatedTextProps) {
  const { enabled, targetLang, translate } = useTranslation();
  const [displayText, setDisplayText] = useState(children);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const key = `${enabled}|${targetLang}|${children}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    if (!enabled || !children) {
      setDisplayText(children);
      return;
    }

    let cancelled = false;
    translate(children).then((result) => {
      if (!cancelled) setDisplayText(result);
    });
    return () => { cancelled = true; };
  }, [enabled, targetLang, children, translate]);

  return (
    <Text style={style} {...props}>
      {displayText}
    </Text>
  );
}
