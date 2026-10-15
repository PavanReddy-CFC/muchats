import { useChatClient } from '../context/ChatProvider';

export function useCurrentUserId(): string {
  return useChatClient().userId;
}
