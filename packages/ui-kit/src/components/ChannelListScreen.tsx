import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ChannelDto, ChannelType } from '@qennect/shared-types';
import { useChatTheme } from '../theme/ThemeProvider';
import { useChannels } from '../hooks/useChannels';
import { EmptyState } from './EmptyState';
import { NewChatScreen } from './NewChatScreen';

export interface ChannelListScreenProps {
  onSelectChannel: (channel: ChannelDto) => void;
}

function initials(channel: ChannelDto): string {
  if (channel.type === ChannelType.DM) return '💬';
  return (channel.name ?? 'G').trim().slice(0, 2).toUpperCase();
}

export function ChannelListScreen({ onSelectChannel }: ChannelListScreenProps): JSX.Element {
  const theme = useChatTheme();
  const { channels } = useChannels();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => (c.name ?? 'direct message').toLowerCase().includes(q));
  }, [channels, query]);

  function handleCreated(channel: ChannelDto): void {
    setCreating(false);
    onSelectChannel(channel);
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={[styles.header, { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3) }]}
      >
        <Text style={[theme.typography.heading, { color: '#fff', fontSize: 20 }]}>Chats</Text>
      </View>

      <View style={{ padding: theme.spacing(2) }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.search,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.full,
              paddingHorizontal: theme.spacing(4),
              paddingVertical: theme.spacing(2),
              ...theme.typography.body,
            },
          ]}
        />
      </View>

      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        estimatedItemSize={68}
        ListEmptyComponent={
          <EmptyState message={query ? 'No chats match your search' : 'No chats yet — tap the button below to start one'} />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelectChannel(item)}
            style={[styles.row, { borderBottomColor: theme.colors.border, padding: theme.spacing(3) }]}
          >
            <View style={[styles.avatar, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full }]}>
              <Text style={styles.avatarText}>{initials(item)}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
              <Text style={[theme.typography.body, { color: theme.colors.text, fontWeight: '600' }]} numberOfLines={1}>
                {item.name ?? 'Direct message'}
              </Text>
              {item.type !== ChannelType.DM && (
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                  {item.memberCount ?? ''} {item.memberCount === 1 ? 'member' : 'members'}
                </Text>
              )}
            </View>
          </Pressable>
        )}
      />

      <Pressable
        onPress={() => setCreating(true)}
        style={[styles.fab, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full }]}
      >
        <Text style={styles.fabIcon}>💬</Text>
      </Pressable>

      <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <NewChatScreen onCreated={handleCreated} onCancel={() => setCreating(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {},
  search: { borderWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  fabIcon: { fontSize: 24 },
});
