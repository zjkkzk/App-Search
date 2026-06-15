import { Redirect } from 'expo-router';

/** 根路径 "/" → 重定向到 Tabs 首页 */
export default function RootIndex() {
  return <Redirect href="/(tabs)" />;
}
