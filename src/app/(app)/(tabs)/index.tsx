import { View, Text } from 'react-native';

export default function HomeTab() {
  return (
    <View style={{ flex: 1, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontSize: 32, fontWeight: 'bold' }}>🎉 页面渲染正常</Text>
      <Text style={{ color: '#FFFFFF', fontSize: 16, marginTop: 12 }}>路由和布局层工作正常</Text>
    </View>
  );
}
