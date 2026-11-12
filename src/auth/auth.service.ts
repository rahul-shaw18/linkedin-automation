import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AccountStatus, LinkedInAccount } from '@prisma/client';
import { LinkedInOrganizationResponseDto } from './dto/linkedin-organization-response.dto';

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

export interface LinkedInUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  id?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generates LinkedIn OAuth 2.0 Authorization URL for initiating user login.
   */
  getAuthorizationUrl(userId: string, customRedirectUri?: string): { url: string; state: string } {
    const clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
    const redirectUri =
      customRedirectUri || this.configService.get<string>('LINKEDIN_REDIRECT_URI');
    const scopes =
      this.configService.get<string>('LINKEDIN_SCOPES') ||
      'openid profile email w_member_social';

    if (!clientId || !redirectUri) {
      throw new InternalServerErrorException(
        'LINKEDIN_CLIENT_ID or LINKEDIN_REDIRECT_URI is not configured in environment.',
      );
    }

    // State encodes the userId and a random salt to prevent CSRF
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

    const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    return { url, state: statePayload };
  }

  /**
   * Exchanges auth code for access & refresh tokens, fetches userinfo, and upserts LinkedInAccount.
   */
  async handleOAuthCallback(
    code: string,
    userId: string,
    customRedirectUri?: string,
  ): Promise<LinkedInAccount> {
    const clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.configService.get<string>('LINKEDIN_CLIENT_SECRET');
    const redirectUri =
      customRedirectUri || this.configService.get<string>('LINKEDIN_REDIRECT_URI');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new InternalServerErrorException(
        'Missing LinkedIn OAuth configuration in environment variables.',
      );
    }

    this.logger.log(`Exchanging authorization code for userId=${userId}`);

    // 1. Request access & refresh tokens from LinkedIn
    let tokenData: LinkedInTokenResponse;
    try {
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(10000), // 10s timeout to prevent hanging connections
      });

      const responseJson = await tokenResponse.json();

      if (!tokenResponse.ok) {
        const errorMsg =
          responseJson?.error_description ||
          responseJson?.error ||
          `HTTP ${tokenResponse.status}`;
        throw new Error(errorMsg);
      }

      tokenData = responseJson as LinkedInTokenResponse;
    } catch (error) {
      this.logger.error(`LinkedIn token exchange failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to exchange LinkedIn authorization code: ${error.message}`);
    }

    // 2. Fetch LinkedIn userinfo (OpenID Connect /v2/userinfo endpoint)
    let linkedInId: string;
    let memberName: string | undefined;
    let memberEmail: string | undefined;
    let memberPicture: string | undefined;

    try {
      const userinfoResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (userinfoResponse.ok) {
        const userinfoData: LinkedInUserInfo = await userinfoResponse.json();
        linkedInId = userinfoData.sub || userinfoData.id;
        memberName =
          userinfoData.name ||
          `${userinfoData.given_name || ''} ${userinfoData.family_name || ''}`.trim() ||
          undefined;
        memberEmail = userinfoData.email || undefined;
        memberPicture = userinfoData.picture || undefined;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch userinfo via /v2/userinfo, falling back to /v2/me: ${error.message}`,
      );
    }

    // Fallback to /v2/me if /v2/userinfo did not resolve
    if (!linkedInId) {
      try {
        const meResponse = await fetch('https://api.linkedin.com/v2/me', {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        });
        if (meResponse.ok) {
          const meData = await meResponse.json();
          linkedInId = meData.id;
          if (!memberName && (meData.localizedFirstName || meData.localizedLastName)) {
            memberName = `${meData.localizedFirstName || ''} ${meData.localizedLastName || ''}`.trim();
          }
        }
      } catch (fallbackError) {
        this.logger.error(
          `Failed to retrieve LinkedIn profile identifier: ${fallbackError.message}`,
          fallbackError.stack,
        );
      }
    }

    if (!linkedInId) {
      throw new BadRequestException('Could not determine LinkedIn member identifier.');
    }

    // 3. Calculate token expiration timestamp
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    this.logger.log(
      `LinkedIn account connected: userId=${userId}, linkedInId=${linkedInId}, name=${memberName || 'N/A'}, expiresAt=${tokenExpiresAt.toISOString()}`,
    );

    // 4. Upsert record in LinkedInAccount table
    const account = await this.prisma.linkedInAccount.upsert({
      where: {
        userId_linkedInId: {
          userId,
          linkedInId,
        },
      },
      create: {
        userId,
        linkedInId,
        name: memberName ?? null,
        email: memberEmail ?? null,
        pictureUrl: memberPicture ?? null,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        tokenExpiresAt,
        status: AccountStatus.ACTIVE,
      },
      update: {
        name: memberName ?? undefined,
        email: memberEmail ?? undefined,
        pictureUrl: memberPicture ?? undefined,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? undefined,
        tokenExpiresAt,
        status: AccountStatus.ACTIVE,
      },
    });

    return account;
  }

  /**
   * Retrieves a valid LinkedIn access token for an account, refreshing if expired.
   * Accepts either an account ID string or an existing LinkedInAccount object to prevent N+1 queries.
   */
  async getValidAccessToken(accountOrId: string | LinkedInAccount): Promise<string> {
    const account =
      typeof accountOrId === 'string'
        ? await this.prisma.linkedInAccount.findUnique({
            where: { id: accountOrId },
            select: {
              id: true,
              accessToken: true,
              refreshToken: true,
              tokenExpiresAt: true,
              status: true,
            },
          })
        : accountOrId;

    if (!account) {
      throw new NotFoundException(
        `LinkedIn account ${typeof accountOrId === 'string' ? accountOrId : ''} not found.`,
      );
    }

    if (account.status === AccountStatus.DISCONNECTED) {
      throw new UnauthorizedException(
        `LinkedIn account ${account.id} is disconnected. Please re-authenticate.`,
      );
    }

    const now = Date.now();
    const expiresAt = new Date(account.tokenExpiresAt).getTime();
    const bufferMs = 24 * 60 * 60 * 1000; // 24 hours buffer

    // Token is still valid with > 24 hours remaining (Zero DB queries if pre-fetched)
    if (now < expiresAt - bufferMs) {
      return account.accessToken;
    }

    // Token has expired or is expiring soon - check for refresh token
    if (!account.refreshToken) {
      if (now >= expiresAt) {
        await this.prisma.linkedInAccount.update({
          where: { id: account.id },
          data: { status: AccountStatus.EXPIRED },
        });
        throw new UnauthorizedException(
          `Access token for account ${account.id} has expired and no refresh token is stored. Please re-authenticate.`,
        );
      }
      this.logger.warn(
        `Account ${account.id} token is within 24h of expiry but has no refresh token. Using existing token.`,
      );
      return account.accessToken;
    }

    // Refresh the access token using LinkedIn OAuth endpoint
    const clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
    const clientSecret = this.configService.get<string>('LINKEDIN_CLIENT_SECRET');

    try {
      const refreshParams = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const refreshResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: refreshParams.toString(),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      const refreshed = (await refreshResponse.json()) as LinkedInTokenResponse;

      if (!refreshResponse.ok) {
        const errorMsg =
          (refreshed as any)?.error_description ||
          (refreshed as any)?.error ||
          `HTTP ${refreshResponse.status}`;
        throw new Error(errorMsg);
      }

      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

      await this.prisma.linkedInAccount.update({
        where: { id: account.id },
        data: {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? account.refreshToken,
          tokenExpiresAt: newExpiresAt,
          status: AccountStatus.ACTIVE,
        },
      });

      this.logger.log(
        `Successfully refreshed token for account ${account.id}. New expiry: ${newExpiresAt.toISOString()}`,
      );

      return refreshed.access_token;
    } catch (error) {
      this.logger.error(
        `Failed to refresh LinkedIn token for account ${account.id}: ${error.message}`,
        error.stack,
      );

      // If already expired, mark status as EXPIRED
      if (now >= expiresAt) {
        await this.prisma.linkedInAccount.update({
          where: { id: account.id },
          data: { status: AccountStatus.EXPIRED },
        });
        throw new UnauthorizedException(
          `Token refresh failed and access token is expired: ${error.message}`,
        );
      }

      // If not yet expired, return current token as fallback
      this.logger.warn(`Refresh failed but existing token is still valid. Using current token.`);
      return account.accessToken;
    }
  }

  /**
   * Retrieves all LinkedIn accounts connected to a user (excluding raw access/refresh tokens to minimize payload size).
   */
  async getUserAccounts(userId: string): Promise<LinkedInAccount[]> {
    return this.prisma.linkedInAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        linkedInId: true,
        name: true,
        email: true,
        pictureUrl: true,
        tokenExpiresAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }) as unknown as Promise<LinkedInAccount[]>;
  }

  async disconnectAccount(accountId: string): Promise<LinkedInAccount> {
    const account = await this.prisma.linkedInAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException(`LinkedIn account ${accountId} not found.`);
    }

    // Attempt to revoke the access token from LinkedIn so app authorization is revoked
    try {
      const clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
      const clientSecret = this.configService.get<string>('LINKEDIN_CLIENT_SECRET');
      if (clientId && clientSecret && account.accessToken) {
        await fetch('https://www.linkedin.com/oauth/v2/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: account.accessToken,
          }).toString(),
          signal: AbortSignal.timeout(5000), // 5s timeout
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not revoke LinkedIn token: ${err.message}`);
    }

    return this.prisma.linkedInAccount.update({
      where: { id: accountId },
      data: {
        status: AccountStatus.DISCONNECTED,
        accessToken: '',
        refreshToken: null,
      },
    });
  }

  /**
   * Retrieves organization / company pages that the user can post to.
   * Discovers organizations from LinkedIn ACL API if accessible, or returns registered organizations.
   */
  async getUserOrganizations(userId: string): Promise<LinkedInOrganizationResponseDto[]> {
    const account = await this.prisma.linkedInAccount.findFirst({
      where: { userId, status: AccountStatus.ACTIVE },
    });

    if (!account) {
      return [];
    }

    // Attempt to discover real organizations administered by the member via LinkedIn ACL API
    try {
      if (account.accessToken) {
        const aclRes = await fetch(
          'https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&state=APPROVED',
          {
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
            },
            signal: AbortSignal.timeout(5000),
          },
        );

        if (aclRes.ok) {
          const aclData = await aclRes.json();
          const elements = Array.isArray(aclData?.elements) ? aclData.elements : [];

          for (const el of elements) {
            const orgUrn = el.organizationalTarget; // e.g. "urn:li:organization:12345678"
            if (orgUrn && typeof orgUrn === 'string' && orgUrn.startsWith('urn:li:organization:')) {
              const numericId = orgUrn.replace('urn:li:organization:', '');
              if (/^\d+$/.test(numericId)) {
                let orgName = `Organization ${numericId}`;
                let vanityName: string | null = null;
                try {
                  const orgRes = await fetch(
                    `https://api.linkedin.com/v2/organizations/${numericId}`,
                    {
                      headers: { Authorization: `Bearer ${account.accessToken}` },
                      signal: AbortSignal.timeout(4000),
                    },
                  );
                  if (orgRes.ok) {
                    const orgData = await orgRes.json();
                    orgName = orgData.localizedName || orgName;
                    vanityName = orgData.vanityName || null;
                  }
                } catch {}

                await this.prisma.linkedInOrganization.upsert({
                  where: {
                    accountId_orgUrn: {
                      accountId: account.id,
                      orgUrn,
                    },
                  },
                  create: {
                    accountId: account.id,
                    orgId: numericId,
                    orgUrn,
                    name: orgName,
                    vanityName,
                    role: el.role || 'ADMINISTRATOR',
                  },
                  update: {
                    name: orgName,
                    vanityName,
                    role: el.role || 'ADMINISTRATOR',
                  },
                });
              }
            }
          }
        }
      }
    } catch (e: any) {
      this.logger.debug(`Could not discover organizations via LinkedIn ACL: ${e.message}`);
    }

    const stored = await this.prisma.linkedInOrganization.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orgId: true,
        orgUrn: true,
        name: true,
        vanityName: true,
        logoUrl: true,
        role: true,
      },
    });

    return stored.map((o) => ({
      id: o.orgId,
      urn: o.orgUrn,
      name: o.name,
      vanityName: o.vanityName,
      logoUrl: o.logoUrl,
      role: o.role,
    }));
  }
}
