import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkedInApiClient } from './linkedin-api.client';
import { AccountStatus, LinkedInAccount } from '@prisma/client';
import { LinkedInAccountResponseDto } from './dto/linkedin-account-response.dto';

const accountSelect = {
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
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkedInApi: LinkedInApiClient,
  ) {}

  getAuthorizationUrl(userId?: string, customRedirectUri?: string): { url: string; state: string } {
    const effectiveUserId =
      userId?.trim() || `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return this.linkedInApi.getAuthorizationUrl(effectiveUserId, customRedirectUri);
  }

  async handleOAuthCallback(
    code: string,
    userId: string,
    customRedirectUri?: string,
  ): Promise<LinkedInAccountResponseDto> {
    this.logger.log(`Exchanging authorization code for userId=${userId}`);

    const tokenData = await this.linkedInApi.exchangeCodeForTokens(code, customRedirectUri);
    const userInfo = await this.linkedInApi.fetchUserInfo(tokenData.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Look for an existing account registered for this permanent LinkedIn member
    const existingAccount = await this.prisma.linkedInAccount.findFirst({
      where: { linkedInId: userInfo.id },
      orderBy: { createdAt: 'asc' },
    });

    const targetUserId = existingAccount?.userId || userInfo.id;
    const targetAccountId = existingAccount?.id;

    // Use transaction to ensure account upsert and past post reassignment are atomic
    return this.prisma.$transaction(async (tx) => {
      let account: LinkedInAccountResponseDto;
      if (targetAccountId) {
        account = await tx.linkedInAccount.update({
          where: { id: targetAccountId },
          data: {
            status: AccountStatus.ACTIVE,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token ?? undefined,
            tokenExpiresAt,
            name: userInfo.name ?? undefined,
            email: userInfo.email ?? undefined,
            pictureUrl: userInfo.picture ?? undefined,
          },
          select: accountSelect,
        });
      } else {
        account = await tx.linkedInAccount.create({
          data: {
            userId: targetUserId,
            linkedInId: userInfo.id,
            name: userInfo.name ?? null,
            email: userInfo.email ?? null,
            pictureUrl: userInfo.picture ?? null,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token ?? null,
            tokenExpiresAt,
            status: AccountStatus.ACTIVE,
          },
          select: accountSelect,
        });
      }

      // Consolidate past posts for this member to the canonical userId and account
      await tx.scheduledPost.updateMany({
        where: {
          account: { linkedInId: userInfo.id },
        },
        data: {
          userId: targetUserId,
          accountId: account.id,
        },
      });

      this.logger.log(
        `LinkedIn account connected: userId=${account.userId}, accountId=${account.id}, linkedInId=${userInfo.id}, name=${userInfo.name || 'N/A'}`,
      );

      return account;
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to refresh LinkedIn token for account ${account.id}: ${errorMsg}`,
        errorStack,
      );

      if (now >= expiresAt) {
        await this.prisma.linkedInAccount.update({
          where: { id: account.id },
          data: { status: AccountStatus.EXPIRED },
        });
        throw new UnauthorizedException(
          `Token refresh failed and access token is expired: ${errorMsg}`,
        );
      }

      this.logger.warn(`Refresh failed but existing token is still valid. Using current token.`);
      return account.accessToken;
    }
  }

  async getUserAccounts(userId: string): Promise<LinkedInAccountResponseDto[]> {
    return this.prisma.linkedInAccount.findMany({
      where: {
        OR: [
          { userId },
          { linkedInId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: accountSelect,
    });
  }

  async disconnectAccount(accountId: string): Promise<LinkedInAccountResponseDto> {
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
      select: accountSelect,
    });
  }
}
