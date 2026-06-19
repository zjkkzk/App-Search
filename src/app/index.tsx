import { Redirect } from 'expo-router';

/** 根路由 `/` → 直接重定向到首页 Tab */
export default function Index() {
  return <Redirect href="/(tabs)/home" />;
}
