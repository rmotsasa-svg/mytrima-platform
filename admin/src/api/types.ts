/** Mirrors AdminAuthService's real response shapes (admin-auth/admin-auth.service.ts). */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AdminMfaEnrollStartResult {
  secret: string;
  otpauthUrl: string;
}

/** Mirrors PublicAdminUserRecord. */
export interface AdminProfile {
  id: string;
  email: string;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}
