import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LinkedInAccount } from '@prisma/client';

export const LINKEDIN_POSTS_ENDPOINT = 'https://api.linkedin.com/rest/posts';

export interface PublishResult {
  postId: string;
  responseData: Record<string, unknown>;
}

@Injectable()
export class LinkedInPostService {
  private readonly logger = new Logger(LinkedInPostService.name);

  constructor(private readonly configService: ConfigService) {}

  async publishPostToLinkedIn(
    account: LinkedInAccount,
    content: string,
    overrideAccessToken?: string,
  ): Promise<PublishResult> {
    const accessToken = overrideAccessToken || account.accessToken;
    const apiVersion = this.configService.get<string>('LINKEDIN_API_VERSION') || '202610';
    const authorUrn = `urn:li:person:${account.linkedInId}`;

    this.logger.log(
      `Publishing post for author=${authorUrn}, accountId=${account.id}, length=${content.length} chars`,
    );

    const postPayload = {
      author: authorUrn,
      commentary: content,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetch(LINKEDIN_POSTS_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(postPayload),
        signal: AbortSignal.timeout(15000),
      });

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const status = response.status;
        const linkedinMessage =
          (responseBody?.message as string) ||
          (responseBody?.errorDetail as string) ||
          (responseBody?.description as string) ||
          `HTTP Error ${status}`;

        this.logger.error(`LinkedIn API returned error (HTTP ${status}): ${linkedinMessage}`);

        if (status === 401) {
          throw new UnauthorizedException(
            `LinkedIn authorization expired or invalid: ${linkedinMessage}. Please reconnect account.`,
          );
        }

        if (status === 403) {
          throw new ForbiddenException(
            `LinkedIn permission denied (${status}): ${linkedinMessage}. The application lacks w_member_social scope.`,
          );
        }

        if (status === 400 || status === 422) {
          throw new BadRequestException(linkedinMessage);
        }

        if (status === 429) {
          throw new HttpException(
            `LinkedIn rate limit reached. Please schedule this post for later. Details: ${linkedinMessage}`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        throw new InternalServerErrorException(
          `LinkedIn API communication error (${status}): ${linkedinMessage}`,
        );
      }

      const restliId =
        response.headers.get('x-restli-id') ||
        response.headers.get('x-linkedin-id') ||
        (responseBody?.id as string) ||
        (responseBody?.urn as string) ||
        `urn:li:share:${Date.now()}`;

      this.logger.log(`Successfully published post to LinkedIn. Post URN: ${restliId}`);

      return {
        postId: String(restliId),
        responseData: responseBody,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof InternalServerErrorException ||
        error instanceof HttpException
      ) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Network error communicating with LinkedIn: ${msg}`, stack);
      throw new InternalServerErrorException(`LinkedIn API network error: ${msg}`);
    }
  }

  async deletePostFromLinkedIn(
    account: LinkedInAccount,
    postUrn: string,
    overrideAccessToken?: string,
  ): Promise<boolean> {
    const accessToken = overrideAccessToken || account.accessToken;
    const apiVersion = this.configService.get<string>('LINKEDIN_API_VERSION') || '202610';

    this.logger.log(
      `Deleting post from LinkedIn for author urn:li:person:${account.linkedInId}, postUrn=${postUrn}`,
    );

    const encodedUrn = encodeURIComponent(postUrn);
    const url = `${LINKEDIN_POSTS_ENDPOINT}/${encodedUrn}`;

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Method': 'DELETE',
    };

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(15000),
      });

      // 204 No Content is LinkedIn's standard success response.
      // 404 Not Found indicates the post is already gone (idempotent delete).
      if (response.status === 204 || response.status === 200 || response.status === 404) {
        this.logger.log(
          `LinkedIn post ${postUrn} successfully deleted from LinkedIn (HTTP ${response.status}).`,
        );
        return true;
      }

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const linkedinMessage =
        (responseBody?.message as string) ||
        (responseBody?.errorDetail as string) ||
        (responseBody?.description as string) ||
        `HTTP Error ${response.status}`;

      this.logger.error(
        `LinkedIn API DELETE failed (HTTP ${response.status}): ${linkedinMessage}`,
      );

      if (response.status === 401) {
        throw new UnauthorizedException(
          `LinkedIn authorization expired or invalid: ${linkedinMessage}. Please reconnect account.`,
        );
      }

      if (response.status === 403) {
        throw new ForbiddenException(
          `LinkedIn permission denied on delete (${response.status}): ${linkedinMessage}.`,
        );
      }

      if (response.status === 429) {
        throw new HttpException(
          `LinkedIn rate limit reached on delete. Details: ${linkedinMessage}`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new InternalServerErrorException(
        `LinkedIn API communication error on delete (${response.status}): ${linkedinMessage}`,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof InternalServerErrorException ||
        error instanceof HttpException
      ) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Network error deleting LinkedIn post: ${msg}`, stack);
      throw new InternalServerErrorException(`LinkedIn API network error: ${msg}`);
    }
  }

  async updatePostOnLinkedIn(
    account: LinkedInAccount,
    postUrn: string,
    content: string,
    overrideAccessToken?: string,
  ): Promise<boolean> {
    const accessToken = overrideAccessToken || account.accessToken;
    const apiVersion = this.configService.get<string>('LINKEDIN_API_VERSION') || '202610';

    this.logger.log(
      `Updating commentary for LinkedIn post ${postUrn}, accountId=${account.id}, length=${content.length} chars`,
    );

    const encodedUrn = encodeURIComponent(postUrn);
    const url = `${LINKEDIN_POSTS_ENDPOINT}/${encodedUrn}`;

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Method': 'PARTIAL_UPDATE',
      'Content-Type': 'application/json',
    };

    const payload = {
      patch: {
        $set: {
          commentary: content,
        },
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      // 204 No Content or 200 OK indicates success for RestLi partial update
      if (response.status === 204 || response.status === 200) {
        this.logger.log(`LinkedIn post ${postUrn} commentary updated successfully.`);
        return true;
      }

      const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const linkedinMessage =
        (responseBody?.message as string) ||
        (responseBody?.errorDetail as string) ||
        (responseBody?.description as string) ||
        `HTTP Error ${response.status}`;

      this.logger.error(
        `LinkedIn API PARTIAL_UPDATE failed (HTTP ${response.status}): ${linkedinMessage}`,
      );

      if (response.status === 401) {
        throw new UnauthorizedException(
          `LinkedIn authorization expired or invalid: ${linkedinMessage}. Please reconnect account.`,
        );
      }

      if (response.status === 403) {
        throw new ForbiddenException(
          `LinkedIn permission denied on update (${response.status}): ${linkedinMessage}.`,
        );
      }

      if (response.status === 404) {
        throw new NotFoundException(
          `Post ${postUrn} not found on LinkedIn. It may have been deleted on LinkedIn.`,
        );
      }

      if (response.status === 400 || response.status === 422) {
        throw new BadRequestException(
          `LinkedIn rejected post update: ${linkedinMessage}`,
        );
      }

      if (response.status === 429) {
        throw new HttpException(
          `LinkedIn rate limit reached on update. Details: ${linkedinMessage}`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new InternalServerErrorException(
        `LinkedIn API communication error on update (${response.status}): ${linkedinMessage}`,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException ||
        error instanceof HttpException
      ) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Network error updating LinkedIn post: ${msg}`, stack);
      throw new InternalServerErrorException(`LinkedIn API network error: ${msg}`);
    }
  }
}
