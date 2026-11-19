import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { LinkedInCallbackDto } from './dto/linkedin-callback.dto';
import { LinkedInAccountResponseDto } from './dto/linkedin-account-response.dto';
import { GetLoginUrlQueryDto, OAuthCallbackQueryDto } from './dto/auth-query.dto';

@ApiTags('LinkedIn Auth')
@Controller('auth/linkedin')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  @Get('login-url')
  @ApiOperation({
    summary: 'Generate LinkedIn OAuth 2.0 Authorization URL',
    description:
      'Creates the redirect URL to send users to LinkedIn for authorizing the application.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the authorization URL and state parameter',
  })
  getLoginUrl(@Query() query: GetLoginUrlQueryDto) {
    return this.authService.getAuthorizationUrl(query.userId, query.redirectUri);
  }

  @Get('callback')
  @ApiOperation({
    summary: 'Handle LinkedIn OAuth Browser Redirect (GET)',
    description:
      'Handles the direct browser redirect from LinkedIn OAuth consent screen, decodes state, exchanges code for tokens, stores the account, sets HttpOnly session cookie, and redirects to frontend.',
  })
  async handleGetCallback(
    @Query() query: OAuthCallbackQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

    if (query.error) {
      return reply.status(302).redirect(
        `${frontendUrl}/?error=${encodeURIComponent(query.error_description || query.error)}`,
      );
    }

    if (!query.code) {
      return reply.status(302).redirect(
        `${frontendUrl}/?error=${encodeURIComponent('Missing authorization code from LinkedIn.')}`,
      );
    }

    let userId = 'default_user';
    if (query.state) {
      try {
        const decoded = JSON.parse(Buffer.from(query.state, 'base64url').toString('utf8'));
        if (decoded.userId) {
          userId = decoded.userId;
        }
      } catch {}
    }

    try {
      const account = await this.authService.handleOAuthCallback(query.code, userId);
      this.sessionService.setSessionCookie(reply, account.userId);

      return reply.status(302).redirect(
        `${frontendUrl}/?connected=true&userId=${encodeURIComponent(account.userId)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LinkedIn connection failed';
      return reply.status(302).redirect(
        `${frontendUrl}/?error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current active session from HttpOnly cookie',
    description:
      'Reads the HttpOnly la_session cookie, verifies existing accounts, and returns the active user and LinkedIn profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'Active session data or null if not authenticated',
  })
  async getMe(@Req() req: FastifyRequest) {
    const sessionUserId = this.sessionService.extractSessionUserId(req);
    if (!sessionUserId) {
      return { authenticated: false, userId: null, account: null };
    }
    const accounts = await this.authService.getUserAccounts(sessionUserId);
    const activeAccount = accounts.find((acc) => acc.status === 'ACTIVE') || accounts[0] || null;

    return {
      authenticated: !!activeAccount,
      userId: activeAccount ? activeAccount.userId : sessionUserId,
      account: activeAccount,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear user session and remove HttpOnly cookie',
    description: 'Clears the la_session HttpOnly cookie to log out the user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
  })
  async logout(@Res({ passthrough: true }) reply: FastifyReply) {
    this.sessionService.clearSessionCookie(reply);
    return { success: true, message: 'Logged out successfully' };
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle LinkedIn OAuth Callback',
    description:
      'Exchanges authorization code for access and refresh tokens, fetches member profile, and stores/updates the account.',
  })
  @ApiResponse({
    status: 200,
    description: 'LinkedIn account successfully linked or refreshed',
    type: LinkedInAccountResponseDto,
  })
  async handleCallback(
    @Body() dto: LinkedInCallbackDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LinkedInAccountResponseDto> {
    const account = await this.authService.handleOAuthCallback(
      dto.code,
      dto.userId,
      dto.redirectUri,
    );

    this.sessionService.setSessionCookie(reply, account.userId);

    return account;
  }

  @Get('accounts/:userId')
  @ApiOperation({
    summary: 'List connected LinkedIn accounts for a user',
    description: 'Retrieves all linked LinkedIn accounts with token status and metadata.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of connected LinkedIn accounts',
    type: [LinkedInAccountResponseDto],
  })
  async getUserAccounts(
    @Param('userId') userId: string,
  ): Promise<LinkedInAccountResponseDto[]> {
    return this.authService.getUserAccounts(userId);
  }

  @Delete('accounts/:accountId')
  @ApiOperation({
    summary: 'Disconnect a LinkedIn account',
    description: 'Marks the account status as DISCONNECTED and disables future post execution.',
  })
  @ApiResponse({
    status: 200,
    description: 'Account successfully disconnected',
    type: LinkedInAccountResponseDto,
  })
  async disconnectAccount(
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LinkedInAccountResponseDto> {
    const account = await this.authService.disconnectAccount(accountId);
    this.sessionService.clearSessionCookie(reply);
    return account;
  }
}
