import { z } from 'zod';

export const RegisterInputSchema = z.object({
  tenantSlug: z.string().min(2).max(63),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  tenantSlug: z.string().min(2).max(63),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  deviceName: z.string().min(1).max(120).optional(),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

/** Federated login: the calling app has already authenticated the member against Qennect's
 *  own backend. muchats trusts `qennectMemberId`/`qennectClientId` as supplied — there is no
 *  qennect-be token-introspection call — and finds-or-creates the chat user using
 *  `qennectMemberId` directly as `User.id` — never a separately-minted id — so a chat user id
 *  is always identical to the Qennect member id it belongs to. */
export const FederatedLoginInputSchema = z.object({
  tenantSlug: z.string().min(2).max(63),
  // Trimmed because this string becomes `User.id` verbatim — a stray leading/trailing space on
  // one login and not another would silently mint a second, disconnected chat identity for the
  // same Qennect member.
  qennectMemberId: z.string().trim().min(1),
  qennectClientId: z.string().min(1),
});
export type FederatedLoginInput = z.infer<typeof FederatedLoginInputSchema>;

export const RefreshInputSchema = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshInput = z.infer<typeof RefreshInputSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export interface JwtAccessTokenClaims {
  sub: string; // userId
  tenantId: string;
  sessionId: string;
  role: string;
  /** Platform-level flag, independent of `role` (which is this tenant's role only). */
  isSuperAdmin: boolean;
}

export interface MeDto {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  role: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
}

/** One community (tenant) the current user belongs to — backs the "switch community" flow.
 *  Same userId, many of these; the client picks one by `tenantId` and exchanges the current
 *  session for a token scoped to it via `POST /auth/switch-community`, no re-login. */
export interface CommunityMembershipDto {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
}

export const SwitchCommunityInputSchema = z.object({
  tenantId: z.string().uuid(),
});
export type SwitchCommunityInput = z.infer<typeof SwitchCommunityInputSchema>;
