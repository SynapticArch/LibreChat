import type {
  IOAuthAuthorizationCode,
  IOAuthClient,
  IOAuthGrant,
  IOAuthToken,
  IUser,
  OAuthClientType,
} from '@librechat/data-schemas';
import type { Model, Types } from 'mongoose';

export interface OAuthModels {
  OAuthAuthorizationCode: Model<IOAuthAuthorizationCode>;
  OAuthClient: Model<IOAuthClient>;
  OAuthGrant: Model<IOAuthGrant>;
  OAuthToken: Model<IOAuthToken>;
  User: Model<IUser>;
}

export interface OAuthClientInput {
  name?: string;
  type?: OAuthClientType;
  description?: string;
  homepageUrl?: string;
  logoUrl?: string;
  redirectUris?: string[];
  allowedScopes?: string[];
  rateLimitPerMinute?: number;
  enabled?: boolean;
}

export interface OAuthAuthenticatedClient {
  client: IOAuthClient;
  clientId: string;
}

export interface OAuthAccessContext {
  client: IOAuthClient;
  grant: IOAuthGrant;
  token: IOAuthToken;
  user: IUser;
}

export interface OAuthUserInfo {
  sub?: string;
  id?: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  role?: string;
  roles?: string[];
  isAdmin?: boolean;
  is_admin?: boolean;
  admin?: boolean;
  synapseAdmin?: boolean;
  synapse_admin?: boolean;
  isTrusted?: boolean;
  is_trusted?: boolean;
  authProvider?: string;
  createdAt?: string;
  created_at?: string;
  accountStatus?: string;
  account_status?: string;
  email?: string;
  emailVerified?: boolean;
  email_verified?: boolean;
}

export interface OAuthGrantListItem {
  grantId: string;
  clientId: string;
  clientName?: string;
  userId: string;
  username?: string;
  email?: string;
  scopes: string[];
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthClientResponse {
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
  hasClientSecret: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TokenIssueResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

export type ObjectIdLike = Types.ObjectId | string;
