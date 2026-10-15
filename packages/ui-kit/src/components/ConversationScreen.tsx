import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ChannelDto, ChannelType } from '@qennect/shared-types';
import { useChatTheme } from '../theme/ThemeProvider';
import { useMessages } from '../hooks/useMessages';
import { useTyping } from '../hooks/useTyping';
import { useConnectionState } from '../hooks/useConnectionState';
import { useCurrentUserId } from '../hooks/useCurrentUserId';
import { useReadReceipts } from '../hooks/useReadReceipts';
import { useDmBlockStatus } from '../hooks/useDmBlockStatus';
import { MessageRow, ReceiptStatus } from './MessageRow';
import { Composer, PickedImage } from './Composer';
import { EmptyState } from './EmptyState';
import { GroupInfoScreen } from './GroupInfoScreen';
import { LocalMessage } from '../client/types';

export interface ConversationScreenProps {
  channelId: string;
  /** Optional — renders a header bar with the chat's name when provided; tapping it (for
   *  group chats) opens the group info/members screen. */
  channel?: ChannelDto;
  /** Passed through to Composer — see Composer's own doc comment. Omit to hide the image
   *  button entirely (e.g. a host app that hasn't wired up an image picker yet). */
  onPickImage?: () => Promise<PickedImage | null>;
  /** Called after the group is deleted from the info screen, so the host app can navigate
   *  away (there's nothing left to show for this channelId). */
  onChannelDeleted?: () => void;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function ConversationScreen({ channelId, channel, onPickImage, onChannelDeleted }: ConversationScreenProps): JSX.Element {
  const theme = useChatTheme();
  const currentUserId = useCurrentUserId();
  const { messages, sendMessage, retryMessage, markRead } = useMessages(channelId);
  const { typingUserIds, notifyTyping } = useTyping(channelId);
  const connectionState = useConnectionState();
  const maxOtherReadSeq = useReadReceipts(channelId);
  const isGroup = channel ? channel.type !== ChannelType.DM : false;
  const isDm = channel ? channel.type === ChannelType.DM : false;
  const { status: blockStatus, toggle: toggleBlock, busy: blockBusy } = useDmBlockStatus(channelId, isDm);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const composerDisabled = !!(blockStatus && (blockStatus.blockedByMe || blockStatus.blockedMe));

  // Mark the latest real (server-acked) message read once it changes, so the sender sees a
  // read receipt — WhatsApp marks read as soon as the conversation is open.
  const lastMarkedSeq = useRef(0);
  useEffect(() => {
    const latestRealSeq = messages.reduce((max, m) => (m.seq > max ? m.seq : max), 0);
    if (latestRealSeq > lastMarkedSeq.current) {
      lastMarkedSeq.current = latestRealSeq;
      markRead(latestRealSeq).catch(() => undefined);
    }
  }, [messages, markRead]);

  // FlashList's `inverted` prop expects index 0 = newest, matching a bottom-anchored chat feed.
  // reversed[i + 1] is chronologically just before reversed[i], so consecutive-message
  // grouping (collapsing the repeated sender label) compares against that neighbor.
  const reversed = useMemo(() => {
    const list: (LocalMessage & { showSenderLabel: boolean; receiptStatus: ReceiptStatus })[] = [];
    const chronological = [...messages];
    for (let i = chronological.length - 1; i >= 0; i--) {
      const message = chronological[i];
      const prev = chronological[i - 1];
      const showSenderLabel =
        isGroup &&
        message.authorId !== currentUserId &&
        (!prev ||
          prev.authorId !== message.authorId ||
          new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_WINDOW_MS);

      const receiptStatus: ReceiptStatus = message.pending
        ? 'pending'
        : message.seq <= maxOtherReadSeq
          ? 'read'
          : 'sent';

      list.push({ ...message, showSenderLabel, receiptStatus });
    }
    return list;
  }, [messages, isGroup, currentUserId, maxOtherReadSeq]);

  function handleDeleted(): void {
    setShowGroupInfo(false);
    onChannelDeleted?.();
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {channel && (
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.colors.primary,
              paddingHorizontal: theme.spacing(3),
              paddingVertical: theme.spacing(3),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
          ]}
        >
          <Pressable disabled={!isGroup} onPress={() => setShowGroupInfo(true)} style={{ flex: 1 }}>
            <Text style={[theme.typography.heading, { color: '#fff' }]}>{channel.name ?? 'Chat'}</Text>
            {isGroup && (
              <Text style={[theme.typography.caption, { color: 'rgba(255,255,255,0.75)' }]}>
                {channel.memberCount ?? ''} {channel.memberCount === 1 ? 'member' : 'members'} · tap for info
              </Text>
            )}
          </Pressable>
          {isDm && blockStatus && (
            <Pressable onPress={toggleBlock} disabled={blockBusy} hitSlop={8}>
              <Text style={[theme.typography.caption, { color: '#fff', fontWeight: '700' }]}>
                {blockStatus.blockedByMe ? 'Unblock' : 'Block'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {connectionState !== 'connected' && (
        <View style={[styles.banner, { backgroundColor: theme.colors.surface }]}>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {connectionState === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
          </Text>
        </View>
      )}

      {isDm && blockStatus?.blockedByMe && (
        <View style={[styles.banner, { backgroundColor: theme.colors.surface }]}>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>You blocked this contact</Text>
        </View>
      )}
      {isDm && blockStatus?.blockedMe && !blockStatus.blockedByMe && (
        <View style={[styles.banner, { backgroundColor: theme.colors.surface }]}>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            You can't reply to this conversation
          </Text>
        </View>
      )}

      <FlashList
        data={reversed}
        inverted
        keyExtractor={(item) => item.clientMsgId}
        estimatedItemSize={56}
        contentContainerStyle={{ paddingVertical: theme.spacing(2) }}
        ListEmptyComponent={<EmptyState message="No messages yet — say hello" />}
        renderItem={({ item }) => (
          <MessageRow
            message={item}
            isMine={item.authorId === currentUserId}
            showSenderLabel={item.showSenderLabel}
            receiptStatus={item.receiptStatus}
            onRetry={() => retryMessage(item.clientMsgId)}
          />
        )}
      />

      {typingUserIds.length > 0 && (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, paddingHorizontal: theme.spacing(3) }]}>
          {typingUserIds.length === 1 ? 'typing…' : `${typingUserIds.length} people typing…`}
        </Text>
      )}

      {!composerDisabled && (
        <Composer
          onSend={(body, attachmentIds) => sendMessage(body, undefined, attachmentIds)}
          onChangeText={() => notifyTyping()}
          onPickImage={onPickImage}
        />
      )}

      {channel && isGroup && (
        <Modal visible={showGroupInfo} animationType="slide" onRequestClose={() => setShowGroupInfo(false)}>
          <GroupInfoScreen channel={channel} onClose={() => setShowGroupInfo(false)} onDeleted={handleDeleted} />
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {},
  banner: { paddingVertical: 4, alignItems: 'center' },
});
