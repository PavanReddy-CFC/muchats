import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ChannelDto, ChannelMemberDto, ChannelMemberRole } from '@qennect/shared-types';
import { useChatTheme } from '../theme/ThemeProvider';
import { useChatClient } from '../context/ChatProvider';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';

export interface GroupInfoScreenProps {
  channel: ChannelDto;
  onClose: () => void;
  onDeleted: () => void;
}

function initials(email: string): string {
  return email.trim().slice(0, 2).toUpperCase() || '?';
}

/** Group members + role management + delete-group. Role-change/remove/delete controls are
 *  shown based on the *viewer's own* channel role (best-effort client-side gating) — the
 *  server is the real authority and also allows a tenant (community) admin to do all of this
 *  even when not shown here, per ChannelsService's dual-authorization rule. */
export function GroupInfoScreen({ channel, onClose, onDeleted }: GroupInfoScreenProps): JSX.Element {
  const theme = useChatTheme();
  const client = useChatClient();

  const [members, setMembers] = useState<ChannelMemberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    client
      .listChannelMembers(channel.id)
      .then(setMembers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load members'));
  }, [client, channel.id]);

  useEffect(() => {
    load();
  }, [load]);

  const self = members?.find((m) => m.userId === client.userId);
  const isAdmin = self?.role === ChannelMemberRole.ADMIN || self?.role === ChannelMemberRole.OWNER;
  const isOwner = self?.role === ChannelMemberRole.OWNER;

  async function toggleAdmin(member: ChannelMemberDto): Promise<void> {
    setBusyUserId(member.userId);
    setError(null);
    try {
      const nextRole = member.role === ChannelMemberRole.ADMIN ? ChannelMemberRole.MEMBER : ChannelMemberRole.ADMIN;
      await client.updateChannelMemberRole(channel.id, member.userId, nextRole);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(member: ChannelMemberDto): Promise<void> {
    setBusyUserId(member.userId);
    setError(null);
    try {
      await client.removeChannelMember(channel.id, member.userId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleDeleteGroup(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await client.deleteChannel(channel.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
      setDeleting(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3) },
        ]}
      >
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={{ color: '#fff', fontSize: 16 }}>✕</Text>
        </Pressable>
        <Text style={[theme.typography.heading, { color: '#fff' }]}>{channel.name ?? 'Group info'}</Text>
        <View style={{ width: 16 }} />
      </View>

      {error && (
        <View style={{ padding: theme.spacing(2) }}>
          <ErrorState message={error} onRetry={() => setError(null)} />
        </View>
      )}

      {!members ? (
        <LoadingState />
      ) : (
        <FlashList
          data={members}
          keyExtractor={(item) => item.userId}
          estimatedItemSize={64}
          renderItem={({ item }) => {
            const isSelf = item.userId === client.userId;
            const busy = busyUserId === item.userId;
            return (
              <View style={[styles.row, { borderBottomColor: theme.colors.border, padding: theme.spacing(3) }]}>
                <View style={[styles.avatar, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full }]}>
                  <Text style={styles.avatarText}>{initials(item.email)}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
                  <Text style={[theme.typography.body, { color: theme.colors.text }]}>
                    {item.displayName} {isSelf ? '(you)' : ''}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{item.role}</Text>
                </View>
                {isAdmin && item.role !== ChannelMemberRole.OWNER && !isSelf && (
                  <View style={styles.actions}>
                    <Pressable disabled={busy} onPress={() => toggleAdmin(item)} hitSlop={8}>
                      <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                        {item.role === ChannelMemberRole.ADMIN ? 'Remove admin' : 'Make admin'}
                      </Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => removeMember(item)} hitSlop={8}>
                      <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {isOwner && (
        <Pressable
          onPress={handleDeleteGroup}
          disabled={deleting}
          style={[styles.deleteButton, { borderColor: theme.colors.danger, borderRadius: theme.radius.md, margin: theme.spacing(3) }]}
        >
          <Text style={{ color: theme.colors.danger, fontWeight: '700' }}>
            {deleting ? 'Deleting…' : 'Delete group'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  actions: { alignItems: 'flex-end', gap: 6 },
  deleteButton: { borderWidth: 1.5, alignItems: 'center', paddingVertical: 12 },
});
