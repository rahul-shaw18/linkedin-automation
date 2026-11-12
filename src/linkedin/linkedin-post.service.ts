import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LinkedInAccount } from '@prisma/client';

export interface PublishResult {
  postId: string;
  responseData: any;
}

@Injectable()
export class LinkedInPostService {
  private readonly logger = new Logger(LinkedInPostService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Publishes commentary content to the user's LinkedIn profile feed via LinkedIn Posts API (/rest/posts).
   */
  async publishPostToLinkedIn(
    account: LinkedInAccount,
    content: string,
    overrideAccessToken?: string,
    targetUrn?: string | null,
  ): Promise<PublishResult> {
    const accessToken = overrideAccessToken || account.accessToken;
    const apiVersion = this.configService.get<string>('LINKEDIN_API_VERSION') || '202610';
    const authorUrn = targetUrn || `urn:li:person:${account.linkedInId}`;

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
      const response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers,
        body: JSON.stringify(postPayload),
        signal: AbortSignal.timeout(15000), // Fail-fast with 15s timeout to prevent thread and socket hangs
      });

      const responseBody = await response.json().catch(() => ({}));

      if (!response.ok) {
        const status = response.status;
        const linkedinMessage =
          responseBody?.message ||
          responseBody?.errorDetail ||
          responseBody?.description ||
          `HTTP Error ${status}`;

        this.logger.error(
          `Failed to publish post to LinkedIn (HTTP ${status}): ${linkedinMessage}. Full response: ${JSON.stringify(
            responseBody,
          )}`,
        );

        // LinkedIn strictly requires w_organization_social (Community Management API) to post on behalf of an organization.
        if (
          authorUrn.startsWith('urn:li:organization:') &&
          (status === 400 || status === 401 || status === 403 || status === 422)
        ) {
          const allowSimulated =
            this.configService.get<string>('ALLOW_SIMULATED_ORG_POST') === 'true';

          if (allowSimulated) {
            const orgCleanId = authorUrn.replace('urn:li:organization:', '');
            const simulatedUrn = `urn:li:share:org-${orgCleanId}-${Date.now()}`;
            this.logger.log(
              `ALLOW_SIMULATED_ORG_POST is enabled. Recording simulated company page post for ${authorUrn}: ${simulatedUrn}`,
            );
            return {
              postId: simulatedUrn,
              responseData: {
                simulatedUrn,
                note: 'Simulated Company Page publication (LinkedIn requires isolated dedicated developer app for live Community Management API)',
              },
            };
          }

          throw new BadRequestException(
            linkedinMessage,
          );
        }

        if (status === 401 || status === 403) {
          throw new BadRequestException(
            `LinkedIn authorization denied (${status}): ${linkedinMessage}. Please check permissions (w_member_social or w_organization_social).`,
          );
        }

        if (status === 400) {
          throw new BadRequestException(linkedinMessage);
        }

        if (status === 429) {
          throw new BadRequestException(
            `LinkedIn rate limit reached. Please schedule this post for later. Details: ${linkedinMessage}`,
          );
        }

        throw new InternalServerErrorException(
          `LinkedIn API communication error (${status}): ${linkedinMessage}`,
        );
      }

      // LinkedIn Posts API returns the created Post URN in the 'x-restli-id' response header
      const restliId =
        response.headers.get('x-restli-id') ||
        response.headers.get('x-linkedin-id') ||
        responseBody?.id ||
        responseBody?.urn ||
        `urn:li:share:${Date.now()}`;

      this.logger.log(`Successfully published post to LinkedIn. Post URN: ${restliId}`);

      return {
        postId: String(restliId),
        responseData: responseBody || { id: restliId },
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error(`Network error communicating with LinkedIn: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`LinkedIn API network error: ${error.message}`);
    }
  }
}
