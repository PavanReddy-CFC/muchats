import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useChatTheme } from '../theme/ThemeProvider';

export function LoadingState(): JSX.Element {
  const theme = useChatTheme();
  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
