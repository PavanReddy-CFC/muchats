import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useChatTheme } from '../theme/ThemeProvider';
import { LocalMessage } from '../client/types';
import { useAttachmentUrl } from '../hooks/useAttachmentUrl';

export type ReceiptStatus = 'pending' | 'sent' | 'read';

export interface MessageRowProps {
  message: LocalMessage;
  isMine: boolean;
  /** Show the sender's label above the bubble — only meaningful in group chats, and only for
   *  messages from other people (WhatsApp doesn't label your own messages, and never labels
   *  1:1 chats since the header already says who you're talking to). */
  showSenderLabel: boolean;
  receiptStatus: ReceiptStatus;
  onRetry?: () => void;
}

/** authorId is a raw user id (no display-name directory in this SDK yet — see
 *  ARCHITECTURE.md), so the sender label falls back to a short id fragment rather than a
 *  real name. Host apps that have a user directory can layer names on top via their own
 *  wrapper component. */
function shortLabel(authorId: string): string {
  return authorId.slice(0, 8);
}

function senderColor(authorId: string): string {
  const palette = ['#1E88E5', '#8E24AA', '#43A047', '#FB8C00', '#E53935', '#3949AB'];
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) hash = (hash * 31 + authorId.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function Checkmarks({ status, color, readColor }: { status: ReceiptStatus; color: string; readColor: string }): JSX.Element | null {
  if (status === 'pending') return <Text style={{ fontSize: 11, color }}>🕓</Text>;
  if (status === 'sent') return <Text style={{ fontSize: 12, color }}>✓✓</Text>;
  return <Text style={{ fontSize: 12, color: readColor }}>✓✓</Text>;
}

function AttachmentImage({ attachmentId, radius }: { attachmentId: string; radius: number }): JSX.Element {
  const url = useAttachmentUrl(attachmentId);
  if (!url) {
    return (
      <View style={[styles.imagePlaceholder, { borderRadius: radius }]}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  return <Image source={{ uri: url }} style={[styles.image, { borderRadius: radius }]} resizeMode="cover" />;
}

export function MessageRow({ message, isMine, showSenderLabel, receiptStatus, onRetry }: MessageRowProps): JSX.Element {
  const theme = useChatTheme();
  const bubbleColor = isMine ? theme.colors.bubbleMine : theme.colors.bubbleTheirs;
  const textColor = isMine ? theme.colors.bubbleMineText : theme.colors.bubbleTheirsText;
  const [expandedEmoji, setExpandedEmoji] = useState<string | null>(null);
  const expandedReaction = message.reactions.find((r) => r.emoji === expandedEmoji);

  return (
    <View style={[styles.row, { justifyContent: isMine ? 'flex-end' : 'flex-start', paddingHorizontal: theme.spacing(3) }]}>
      <Pressable
        onPress={message.failed ? onRetry : undefined}
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            borderRadius: theme.radius.md,
            borderTopRightRadius: isMine ? 2 : theme.radius.md,
            borderTopLeftRadius: isMine ? theme.radius.md : 2,
            opacity: message.pending ? 0.7 : 1,
            paddingHorizontal: theme.spacing(3),
            paddingTop: theme.spacing(2),
            paddingBottom: theme.spacing(1),
          },
        ]}
      >
        {showSenderLabel && (
          <Text style={[theme.typography.caption, { color: senderColor(message.authorId), fontWeight: '700', marginBottom: 2 }]}>
            {shortLabel(message.authorId)}
          </Text>
        )}

        {message.deletedAt ? (
          <Text style={[theme.typography.body, { color: textColor, fontStyle: 'italic' }]}>Message deleted</Text>
        ) : (
          <>
            {message.attachments
              .filter((a) => a.mimeType.startsWith('image/'))
              .map((a) => <AttachmentImage key={a.id} attachmentId={a.id} radius={theme.radius.sm} />)}
            {message.body.length > 0 && <Text style={[theme.typography.body, { color: textColor }]}>{message.body}</Text>}
          </>
        )}

        {message.failed && (
          <Text style={[theme.typography.caption, { color: theme.colors.danger, marginTop: 2 }]}>
            Failed to send — tap to retry
          </Text>
        )}

        {expandedReaction && (
          <Text style={[theme.typography.caption, { color: textColor, opacity: 0.85, marginTop: 2 }]}>
            {expandedReaction.emoji} reacted by {expandedReaction.userIds.map(shortLabel).join(', ')}
          </Text>
        )}

        <View style={styles.meta}>
          {message.reactions.length > 0 && (
            <View style={styles.reactions}>
              {message.reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => setExpandedEmoji((current) => (current === r.emoji ? null : r.emoji))}
                  hitSlop={4}
                >
                  <Text style={[theme.typography.caption, { color: textColor }]}>
                    {r.emoji} {r.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.metaSpacer} />
          <Text style={[styles.time, { color: textColor, opacity: 0.7 }]}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {isMine && !message.failed && (
            <View style={{ marginLeft: 4 }}>
              <Checkmarks status={receiptStatus} color={textColor} readColor="#4FC3F7" />
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', width: '100%', paddingVertical: 2 },
  bubble: { maxWidth: '80%' },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaSpacer: { flex: 1 },
  time: { fontSize: 11 },
  reactions: { flexDirection: 'row', gap: 6 },
  image: { width: 220, height: 220, marginBottom: 4 },
  imagePlaceholder: {
    width: 220,
    height: 220,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
});
