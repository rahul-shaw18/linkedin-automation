import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

export interface LinkedInOrganizationDetail {
  name: string;
  vanityName: string | null;
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
      url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
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

    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const json = await response.json();
    if (!response.ok) {
      const errorMsg = json?.error_description || json?.error || `HTTP ${response.status}`;
      throw new BadRequestException(`Failed to exchange LinkedIn authorization code: ${errorMsg}`);
    }

    return json as LinkedInTokenResponse;
  }

  async fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
    let linkedInId: string | undefined;
    let memberName: string | undefined;
    let memberEmail: string | undefined;
    let memberPicture: string | undefined;

    try {
      const userinfoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (userinfoRes.ok) {
        const data = await userinfoRes.json();
        linkedInId = data.sub || data.id;
        memberName =
          data.name ||
          `${data.given_name || ''} ${data.family_name || ''}`.trim() ||
          undefined;
        memberEmail = data.email || undefined;
        memberPicture = data.picture || undefined;
      }
    } catch (err: any) {
      this.logger.warn(`Could not fetch profile via /v2/userinfo: ${err.message}`);
    }

    if (!linkedInId) {
      try {
        const meRes = await fetch('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });

        if (meRes.ok) {
          const meData = await meRes.json();
          linkedInId = meData.id;
          if (!memberName && (meData.localizedFirstName || meData.localizedLastName)) {
            memberName = `${meData.localizedFirstName || ''} ${meData.localizedLastName || ''}`.trim();
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not fetch profile via /v2/me: ${err.message}`);
      }
    }

    if (!linkedInId) {
      throw new BadRequestException('Could not determine LinkedIn member identifier.');
    }

    return {
      id: linkedInId,
      name: memberName,
      email: memberEmail,
      picture: memberPicture,
    };
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

    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const json = await response.json();
    if (!response.ok) {
      const errorMsg = json?.error_description || json?.error || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return json as LinkedInTokenResponse;
  }

  async revokeToken(accessToken: string): Promise<void> {
    const clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.configService.get<string>('LINKEDIN_CLIENT_SECRET');

    if (!clientId || !clientSecret || !accessToken) {
      return;
    }

    try {
      await fetch('https://www.linkedin.com/oauth/v2/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token: accessToken,
        }).toString(),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err: any) {
      this.logger.warn(`Could not revoke LinkedIn token: ${err.message}`);
    }
  }

  async fetchOrganizationAcls(accessToken: string): Promise<string[]> {
    try {
      const response = await fetch(
        'https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&state=APPROVED',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000),
        },
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const elements = Array.isArray(data?.elements) ? data.elements : [];

      return elements
        .map((el: any) => el.organizationalTarget)
        .filter(
          (target: any): target is string =>
            typeof target === 'string' && target.startsWith('urn:li:organization:'),
        );
    } catch (err: any) {
      this.logger.debug(`Could not discover organizations via LinkedIn ACL: ${err.message}`);
      return [];
    }
  }

  async fetchOrganizationDetails(
    accessToken: string,
    numericOrgId: string,
  ): Promise<LinkedInOrganizationDetail> {
    const fallback: LinkedInOrganizationDetail = {
      name: `Organization ${numericOrgId}`,
      vanityName: null,
    };

    try {
      const response = await fetch(
        `https://api.linkedin.com/v2/organizations/${numericOrgId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(4000),
        },
      );

      if (!response.ok) {
        return fallback;
      }

      const data = await response.json();
      return {
        name: data.localizedName || fallback.name,
        vanityName: data.vanityName || null,
      };
    } catch {
      return fallback;
    }
  }
}
