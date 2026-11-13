import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkedInApiClient } from './linkedin-api.client';
import { AccountStatus, LinkedInAccount } from '@prisma/client';
import { LinkedInOrganizationResponseDto } from './dto/linkedin-organization-response.dto';
import { extractOrganizationId } from '../common/utils/linkedin.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkedInApi: LinkedInApiClient,
  ) {}

  getAuthorizationUrl(userId: string, customRedirectUri?: string): { url: string; state: string } {
    return this.linkedInApi.getAuthorizationUrl(userId, customRedirectUri);
  }

  async handleOAuthCallback(
    code: string,
    userId: string,
    customRedirectUri?: string,
  ): Promise<LinkedInAccount> {
    this.logger.log(`Exchanging authorization code for userId=${userId}`);

    const tokenData = await this.linkedInApi.exchangeCodeForTokens(code, customRedirectUri);
    const userInfo = await this.linkedInApi.fetchUserInfo(tokenData.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    this.logger.log(
      `LinkedIn account connected: userId=${userId}, linkedInId=${userInfo.id}, name=${userInfo.name || 'N/A'}`,
    );

    return this.prisma.linkedInAccount.upsert({
      where: {
        userId_linkedInId: {
          userId,
          linkedInId: userInfo.id,
        },
      },
      create: {
        userId,
        linkedInId: userInfo.id,
        name: userInfo.name ?? null,
        email: userInfo.email ?? null,
        pictureUrl: userInfo.picture ?? null,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        tokenExpiresAt,
        status: AccountStatus.ACTIVE,
      },
      update: {
        name: userInfo.name ?? undefined,
        email: userInfo.email ?? undefined,
        pictureUrl: userInfo.picture ?? undefined,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? undefined,
        tokenExpiresAt,
        status: AccountStatus.ACTIVE,
      },
    });
  }

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
    const bufferMs = 24 * 60 * 60 * 1000;

    if (now < expiresAt - bufferMs) {
      return account.accessToken;
    }

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

    try {
      const refreshed = await this.linkedInApi.refreshAccessToken(account.refreshToken);
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
    } catch (error: any) {
      this.logger.error(
        `Failed to refresh LinkedIn token for account ${account.id}: ${error.message}`,
        error.stack,
      );

      if (now >= expiresAt) {
        await this.prisma.linkedInAccount.update({
          where: { id: account.id },
          data: { status: AccountStatus.EXPIRED },
        });
        throw new UnauthorizedException(
          `Token refresh failed and access token is expired: ${error.message}`,
        );
      }

      this.logger.warn(`Refresh failed but existing token is still valid. Using current token.`);
      return account.accessToken;
    }
  }

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

    await this.linkedInApi.revokeToken(account.accessToken);

    return this.prisma.linkedInAccount.update({
      where: { id: accountId },
      data: {
        status: AccountStatus.DISCONNECTED,
        accessToken: '',
        refreshToken: null,
      },
    });
  }

  async getUserOrganizations(userId: string): Promise<LinkedInOrganizationResponseDto[]> {
    const account = await this.prisma.linkedInAccount.findFirst({
      where: { userId, status: AccountStatus.ACTIVE },
    });

    if (!account || !account.accessToken) {
      return [];
    }

    const orgUrns = await this.linkedInApi.fetchOrganizationAcls(account.accessToken);

    for (const orgUrn of orgUrns) {
      const numericId = extractOrganizationId(orgUrn);
      if (numericId) {
        const details = await this.linkedInApi.fetchOrganizationDetails(
          account.accessToken,
          numericId,
        );

        await this.prisma.linkedInOrganization.upsert({
          where: {
            accountId_orgUrn: {
              accountId: account.id,
              orgUrn: `urn:li:organization:${numericId}`,
            },
          },
          create: {
            accountId: account.id,
            orgId: numericId,
            orgUrn: `urn:li:organization:${numericId}`,
            name: details.name,
            vanityName: details.vanityName,
            role: 'ADMINISTRATOR',
          },
          update: {
            name: details.name,
            vanityName: details.vanityName,
            role: 'ADMINISTRATOR',
          },
        });
      }
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
