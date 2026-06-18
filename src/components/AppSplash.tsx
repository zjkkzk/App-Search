import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const SPLASH_ICON = require('../../assets/icon.png');
const isWeb = process.env.EXPO_OS === 'web';

export default function AppSplash() {
  const { width, height } = useWindowDimensions();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 380,
        useNativeDriver: !isWeb,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 54,
        useNativeDriver: !isWeb,
      }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 1300,
          useNativeDriver: !isWeb,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1300,
          useNativeDriver: !isWeb,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fadeAnim, floatAnim, scaleAnim]);

  const iconSize = Math.min(width * 0.42, 180);
  const iconTranslateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });
  const pulseOpacity = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.58],
  });

  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      <View style={[styles.auraPrimary, { width: width * 0.9, height: width * 0.9 }]} />
      <View style={[styles.auraSecondary, { width: width * 0.72, height: width * 0.72 }]} />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.logoStage,
            {
              transform: [{ translateY: iconTranslateY }],
            },
          ]}
        >
          <Animated.View style={[styles.logoGlow, { opacity: pulseOpacity }]} />
          <View style={styles.logoCard}>
            <Image
              source={SPLASH_ICON}
              style={{ width: iconSize, height: iconSize }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        </Animated.View>

        <Text style={styles.title}>开源应用商店</Text>
        <Text style={styles.subtitle}>发现 · 探索 · 安装</Text>
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                opacity: pulseOpacity,
                transform: [
                  {
                    translateX: floatAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-42, 42],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
        <Text style={styles.footerText}>正在初始化服务</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    elevation: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FBFF',
  },
  auraPrimary: {
    position: 'absolute',
    top: -140,
    right: -160,
    borderRadius: 9999,
    backgroundColor: '#E8F2FF',
  },
  auraSecondary: {
    position: 'absolute',
    bottom: -120,
    left: -130,
    borderRadius: 9999,
    backgroundColor: '#EEF7F2',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlow: {
    position: 'absolute',
    width: 228,
    height: 228,
    borderRadius: 114,
    backgroundColor: '#CFE4FF',
  },
  logoCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 44,
    backgroundColor: '#FFFFFF',
    shadowColor: '#145DB6',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.14,
    shadowRadius: 34,
    elevation: 10,
  },
  title: {
    marginTop: 28,
    fontSize: 28,
    fontWeight: '800',
    color: '#123A68',
    letterSpacing: 1,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '600',
    color: '#5D7692',
    letterSpacing: 2,
  },
  footer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 74 : 56,
    alignItems: 'center',
  },
  progressTrack: {
    width: 96,
    height: 4,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: '#DCEBFF',
  },
  progressFill: {
    width: 54,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#145DB6',
  },
  footerText: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '600',
    color: '#7B91AA',
    letterSpacing: 1.5,
  },
});
