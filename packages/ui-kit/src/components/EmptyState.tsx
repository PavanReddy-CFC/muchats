import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useChatTheme } from '../theme/ThemeProvider';

export function EmptyState({ message }: { message: string }): JSX.Element {
  const theme = useChatTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: theme.colors.textMuted, ...theme.typography.body }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { textAlign: 'center' },
});
