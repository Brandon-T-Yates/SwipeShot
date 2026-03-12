import 'react-native-gesture-handler'; // MUST BE LINE 1. NO EXCEPTIONS.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

export default function RootLayout() {
  return (
    // We remove the extra <View> to simplify the view hierarchy for the native engine
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});