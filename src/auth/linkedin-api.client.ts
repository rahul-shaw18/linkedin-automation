import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const LINKEDIN_ENDPOINTS = {
  AUTHORIZATION: 'https://www.linkedin.com/oauth/v2/authorization',
  ACCESS_TOKEN: 'https://www.linkedin.com/oauth/v2/accessToken',
  USER_INFO: 'https://api.linkedin.com/v2/userinfo',
  REVOKE: 'https://www.linkedin.com/oauth/v2/revoke',
} as const;

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

export interface LinkedInUserInfo {
  id: string;
  name?: string;
  email?: string;
  picture?: string;
}

@Injectable()
export class LinkedInApiClient {
  private readonly logger = new Logger(LinkedInApiClient.name);

  constructor(private readonly configService: ConfigService) {}

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new InternalServerErrorException(`Missing required configuration: ${key}`);
    }
    return value;
  }

  getAuthorizationUrl(userId: string, customRedirectUri?: string): { url: string; state: string } {
    const clientId = this.getRequiredConfig('LINKEDIN_CLIENT_ID');
    const redirectUri =
      customRedirectUri || this.getRequiredConfig('LINKEDIN_REDIRECT_URI');
    const scopes =
      this.configService.get<string>('LINKEDIN_SCOPES') ||
      'openid profile email w_member_social';

    const statePayload = Buffer.from(
      JSON.stringify({ userId, timestamp: Date.now() }),
    ).toString('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: statePayload,
      scope: scopes,
    });

    return {
      url: `${LINKEDIN_ENDPOINTS.AUTHORIZATION}?${params.toString()}`,
      state: statePayload,
    };
  }

  async exchangeCodeForTokens(
    code: string,
    customRedirectUri?: string,
  ): Promise<LinkedInTokenResponse> {
    const clientId = this.getRequiredConfig('LINKEDIN_CLIENT_ID');
    const clientSecret = this.getRequiredConfig('LINKEDIN_CLIENT_SECRET');
    const redirectUri =
      customRedirectUri || this.getRequiredConfig('LINKEDIN_REDIRECT_URI');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(LINKEDIN_ENDPOINTS.ACCESS_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const json = (await response.json().catch(() => null)) as Record<string, string> | null;
    if (!response.ok) {
      const errorMsg = json?.error_description || json?.error || `HTTP ${response.status}`;
      throw new BadRequestException(`Failed to exchange LinkedIn authorization code: ${errorMsg}`);
    }

    return json as unknown as LinkedInTokenResponse;
  }

  async fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
    try {
      const response = await fetch(LINKEDIN_ENDPOINTS.USER_INFO, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, string>;
      const linkedInId = data.sub || data.id;

      if (!linkedInId) {
        throw new Error('User identifier missing from response');
      }

      return {
        id: linkedInId,
        name:
          data.name ||
          `${data.given_name || ''} ${data.family_name || ''}`.trim() ||
          undefined,
        email: data.email || undefined,
        picture: data.picture || undefined,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch LinkedIn user info: ${errorMsg}`);
      throw new BadRequestException(`Could not retrieve LinkedIn profile: ${errorMsg}`);
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<LinkedInTokenResponse> {
    const clientId = this.getRequiredConfig('LINKEDIN_CLIENT_ID');
    const clientSecret = this.getRequiredConfig('LINKEDIN_CLIENT_SECRET');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(LINKEDIN_ENDPOINTS.ACCESS_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const json = (await response.json().catch(() => null)) as Record<string, string> | null;
    if (!response.ok) {
      const errorMsg = json?.error_description || json?.error || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return json as unknown as LinkedInTokenResponse;
  }

  async revokeToken(accessToken: string): Promise<void> {
    const clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.configService.get<string>('LINKEDIN_CLIENT_SECRET');

    if (!clientId || !clientSecret || !accessToken) {
      return;
    }

    try {
      await fetch(LINKEDIN_ENDPOINTS.REVOKE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token: accessToken,
        }).toString(),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not revoke LinkedIn token: ${msg}`);
    }
  }
}
