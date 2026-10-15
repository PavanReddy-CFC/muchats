import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useChatTheme } from '../theme/ThemeProvider';
import { useChatClient } from '../context/ChatProvider';

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ComposerProps {
  onSend: (body: string, attachmentIds?: string[]) => void;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  /** Image *picking* is the host app's responsibility (expo-image-picker, react-native-image-
   *  picker, etc.) — the SDK stays picker-library-agnostic. When provided, shows an image
   *  button; the Composer handles uploading the result and sending it as an attachment. */
  onPickImage?: () => Promise<PickedImage | null>;
}

export function Composer({ onSend, onChangeText, placeholder = 'Message', onPickImage }: ComposerProps): JSX.Element {
  const theme = useChatTheme();
  const client = useChatClient();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(value: string): void {
    setText(value);
    onChangeText?.(value);
  }

  function handleSend(): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  async function handlePickImage(): Promise<void> {
    if (!onPickImage) return;
    setError(null);
    try {
      const picked = await onPickImage();
      if (!picked) return;
      setUploading(true);
      const attachmentId = await client.uploadAttachment(picked);
      onSend('', [attachmentId]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send image');
    } finally {
      setUploading(false);
    }
  }

  return (
    <View>
      {error && (
        <Text
          style={[
            theme.typography.caption,
            { color: theme.colors.danger, paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(1) },
          ]}
        >
          {error}
        </Text>
      )}
      <View
        style={[
          styles.container,
          { borderTopColor: theme.colors.border, backgroundColor: theme.colors.background, padding: theme.spacing(2) },
        ]}
      >
        {onPickImage && (
          <Pressable onPress={handlePickImage} disabled={uploading} style={styles.imageButton} hitSlop={8}>
            {uploading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Text style={{ fontSize: 20 }}>📷</Text>
            )}
          </Pressable>
        )}
        <TextInput
          value={text}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.spacing(3),
              paddingVertical: theme.spacing(2),
              ...theme.typography.body,
            },
          ]}
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim()}
          style={[
            styles.sendButton,
            { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full, opacity: text.trim() ? 1 : 0.5 },
          ]}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>➤</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  imageButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 120, borderWidth: StyleSheet.hairlineWidth },
  sendButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
