export type SynapseOAuthClientType = 'confidential' | 'public';

export type SynapseOAuthScope = {
  key: string;
  label: string;
  description: string;
  category: string;
  endpoints: string[];
  identityScope?: boolean;
};

export type SynapseOAuthClient = {
  clientId: string;
  type: SynapseOAuthClientType;
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
};

export type SynapseOAuthClientInput = {
  name?: string;
  type?: SynapseOAuthClientType;
  description?: string;
  homepageUrl?: string;
  logoUrl?: string;
  redirectUris?: string[];
  allowedScopes?: string[];
  rateLimitPerMinute?: number;
  enabled?: boolean;
};

export type SynapseOAuthClientResponse = {
  success: boolean;
  client: SynapseOAuthClient;
  clientSecret?: string;
  message?: string;
};

export type SynapseOAuthClientsResponse = {
  success: boolean;
  clients: SynapseOAuthClient[];
};

export type SynapseOAuthScopesResponse = {
  scopes: SynapseOAuthScope[];
};

export type SynapseOAuthGrant = {
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
};

export type SynapseOAuthGrantsResponse = {
  success: boolean;
  grants: SynapseOAuthGrant[];
};

export type SynapseOAuthMutationResponse = {
  success: boolean;
};
