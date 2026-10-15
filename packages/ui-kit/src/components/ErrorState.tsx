import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatTheme } from '../theme/ThemeProvider';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  const theme = useChatTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: theme.colors.danger, ...theme.typography.body }]}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.retry}>
          <Text style={{ color: theme.colors.primary, ...theme.typography.body }}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  text: { textAlign: 'center' },
  retry: { paddingVertical: 8, paddingHorizontal: 16 },
});
