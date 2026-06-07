export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_client_metadata'
  | 'invalid_scope'
  | 'unsupported_response_type'
  | 'unsupported_grant_type'
  | 'access_denied'
  | 'invalid_grant'
  | 'invalid_token'
  | 'insufficient_scope';

export class OAuthProviderError extends Error {
  code: OAuthErrorCode;
  status: number;

  constructor(code: OAuthErrorCode, description: string, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

export function oauthError(code: OAuthErrorCode, description: string, status = 400): never {
  throw new OAuthProviderError(code, description, status);
}
