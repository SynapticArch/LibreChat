import type { Document, Types } from 'mongoose';

export type OAuthClientType = 'confidential' | 'public';
export type OAuthCodeChallengeMethod = 'S256' | 'plain';
export type OAuthTokenKind = 'access' | 'refresh';

export interface IOAuthClient extends Document {
  _id: Types.ObjectId;
  clientId: string;
  type: OAuthClientType;
  name: string;
  description?: string;
  homepageUrl?: string;
  logoUrl?: string;
  redirectUris: string[];
  allowedScopes: string[];
  rateLimitPerMinute: number;
  enabled: boolean;
  secretHash?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

export interface IOAuthGrant extends Document {
  _id: Types.ObjectId;
  clientId: string;
  userId: Types.ObjectId;
  scopes: string[];
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

export interface IOAuthAuthorizationCode extends Document {
  _id: Types.ObjectId;
  codeHash: string;
  clientId: string;
  userId: Types.ObjectId;
  grantId: Types.ObjectId;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: OAuthCodeChallengeMethod;
  usedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  tenantId?: string;
}

export interface IOAuthToken extends Document {
  _id: Types.ObjectId;
  tokenHash: string;
  kind: OAuthTokenKind;
  clientId: string;
  userId: Types.ObjectId;
  grantId: Types.ObjectId;
  scopes: string[];
  revokedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  tenantId?: string;
}
