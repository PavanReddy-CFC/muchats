import { z } from 'zod';
import { TenantRole } from './enums';

export const UpdateMemberRoleInputSchema = z.object({
  role: z.nativeEnum(TenantRole),
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleInputSchema>;

export interface TenantMemberDto {
  userId: string;
  email: string;
  displayName: string;
  role: TenantRole;
  joinedAt: string;
}
