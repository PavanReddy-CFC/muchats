import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { ChannelDto, ChannelType, TenantMemberDto } from '@qennect/shared-types';
import { useChatTheme } from '../theme/ThemeProvider';
import { useChatClient } from '../context/ChatProvider';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';

export interface NewChatScreenProps {
  onCreated: (channel: ChannelDto) => void;
  onCancel: () => void;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

/** WhatsApp-style "start a chat" flow: tap a contact to open a 1:1 chat immediately, or
 *  switch to group mode to multi-select contacts and name a group. */
export function NewChatScreen({ onCreated, onCancel }: NewChatScreenProps): JSX.Element {
  const theme = useChatTheme();
  const client = useChatClient();

  const [members, setMembers] = useState<TenantMemberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupType, setGroupType] = useState<ChannelType>(ChannelType.PRIVATE);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    client
      .listTenantMembers()
      .then((all) => setMembers(all.filter((m) => m.userId !== client.userId)))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load contacts'));
  }, [client]);

  const selectedMembers = useMemo(
    () => (members ?? []).filter((m) => selected.has(m.userId)),
    [members, selected],
  );

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members ?? [];
    return (members ?? []).filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  function toggleSelected(userId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function startDirectChat(member: TenantMemberDto): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const channel = await client.createChannel({ type: ChannelType.DM, memberUserIds: [member.userId] });
      onCreated(channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat');
      setSubmitting(false);
    }
  }

  async function createGroup(): Promise<void> {
    const trimmed = groupName.trim();
    if (!trimmed) {
      setError('Group name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const channel = await client.createChannel({
        type: groupType,
        name: trimmed,
        memberUserIds: Array.from(selected),
      });
      onCreated(channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
      setSubmitting(false);
    }
  }

  if (naming) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background, padding: theme.spacing(4) }]}>
        <Text style={[theme.typography.heading, { color: theme.colors.text, marginBottom: theme.spacing(1) }]}>
          Name your group
        </Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing(4) }]}>
          {selectedMembers.length} {selectedMembers.length === 1 ? 'member' : 'members'} selected
        </Text>
        <TextInput
          value={groupName}
          onChangeText={setGroupName}
          placeholder="Group name"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing(3),
              marginBottom: theme.spacing(3),
              ...theme.typography.body,
            },
          ]}
        />

        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing(1) }]}>
          Visibility
        </Text>
        <View style={{ gap: theme.spacing(2), marginBottom: theme.spacing(4) }}>
          {(
            [
              { type: ChannelType.PUBLIC, label: '# Public', description: 'Anyone in the workspace can find and join' },
              { type: ChannelType.PRIVATE, label: '🔒 Private', description: 'Only invited people can view' },
            ] as const
          ).map((option) => {
            const selectedType = option.type === groupType;
            return (
              <Pressable
                key={option.type}
                onPress={() => setGroupType(option.type)}
                style={[
                  styles.visibilityOption,
                  {
                    borderColor: selectedType ? theme.colors.primary : theme.colors.border,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing(3),
                    backgroundColor: selectedType ? theme.colors.surface : theme.colors.background,
                  },
                ]}
              >
                <Text style={[theme.typography.body, { color: theme.colors.text, fontWeight: '600' }]}>
                  {option.label}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 2 }]}>
                  {option.description}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error && (
          <Text style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing(2) }]}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Pressable onPress={() => setNaming(false)} style={styles.button}>
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Back</Text>
          </Pressable>
          <Pressable
            onPress={createGroup}
            disabled={submitting}
            style={[
              styles.button,
              { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full, paddingHorizontal: theme.spacing(4) },
            ]}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{submitting ? 'Creating…' : 'Create'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3) },
        ]}
      >
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text style={{ color: '#fff', fontSize: 16 }}>✕</Text>
        </Pressable>
        <Text style={[theme.typography.heading, { color: '#fff' }]}>
          {groupMode ? 'New group' : 'New chat'}
        </Text>
        <Pressable onPress={() => setGroupMode((g) => !g)} hitSlop={8}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{groupMode ? 'Cancel' : 'New group'}</Text>
        </Pressable>
      </View>

      {error && !naming && (
        <View style={{ padding: theme.spacing(2) }}>
          <ErrorState message={error} onRetry={() => setError(null)} />
        </View>
      )}

      {members && members.length > 0 && (
        <View style={{ padding: theme.spacing(2) }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search contacts"
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
      )}

      {!members && !error ? (
        <LoadingState />
      ) : (
        <FlashList
          data={filteredMembers}
          keyExtractor={(item) => item.userId}
          estimatedItemSize={64}
          ListEmptyComponent={query ? <EmptyState message="No contacts match your search" /> : null}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.userId);
            return (
              <Pressable
                disabled={submitting}
                onPress={() => (groupMode ? toggleSelected(item.userId) : startDirectChat(item))}
                style={[styles.row, { borderBottomColor: theme.colors.border, padding: theme.spacing(3) }]}
              >
                <View style={[styles.avatar, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full }]}>
                  <Text style={styles.avatarText}>{initials(item.displayName)}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
                  <Text style={[theme.typography.body, { color: theme.colors.text }]}>{item.displayName}</Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{item.email}</Text>
                </View>
                {groupMode && (
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                        backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                        borderRadius: theme.radius.full,
                      },
                    ]}
                  >
                    {isSelected && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      {groupMode && selected.size > 0 && (
        <Pressable
          onPress={() => setNaming(true)}
          style={[styles.fab, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full }]}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Next ({selected.size})</Text>
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
  checkbox: { width: 24, height: 24, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  visibilityOption: { borderWidth: 1.5 },
  input: { borderWidth: StyleSheet.hairlineWidth },
  search: { borderWidth: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, alignItems: 'center' },
  button: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16, paddingHorizontal: 20, paddingVertical: 14 },
});
