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
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LinkedInCallbackDto } from './dto/linkedin-callback.dto';
import { LinkedInAccountResponseDto } from './dto/linkedin-account-response.dto';

@ApiTags('LinkedIn Auth')
@Controller('auth/linkedin')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private setSessionCookie(reply: FastifyReply, userId: string): void {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    reply.setCookie('la_session', userId, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  private clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie('la_session', { path: '/' });
  }

  @Get('login-url')
  @ApiOperation({
    summary: 'Generate LinkedIn OAuth 2.0 Authorization URL',
    description:
      'Creates the redirect URL to send users to LinkedIn for authorizing the application.',
  })
  @ApiQuery({ name: 'userId', required: true, description: 'Application or Clerk User ID' })
  @ApiQuery({
    name: 'redirectUri',
    required: false,
    description: 'Custom OAuth callback redirect URI',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the authorization URL and state parameter',
  })
  getLoginUrl(
    @Query('userId') userId: string,
    @Query('redirectUri') redirectUri?: string,
  ) {
    return this.authService.getAuthorizationUrl(userId, redirectUri);
  }

  @Get('callback')
  @ApiOperation({
    summary: 'Handle LinkedIn OAuth Browser Redirect (GET)',
    description:
      'Handles the direct browser redirect from LinkedIn OAuth consent screen, decodes state, exchanges code for tokens, stores the account, sets HttpOnly session cookie, and redirects to frontend.',
  })
  async handleGetCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

    if (error) {
      return reply.status(302).redirect(
        `${frontendUrl}/?error=${encodeURIComponent(errorDescription || error)}`,
      );
    }

    let userId = 'default_user';
    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        if (decoded.userId) {
          userId = decoded.userId;
        }
      } catch {}
    }

    try {
      const account = await this.authService.handleOAuthCallback(code, userId);
      this.setSessionCookie(reply, account.userId);

      return reply.status(302).redirect(
        `${frontendUrl}/?connected=true&userId=${encodeURIComponent(account.userId)}`,
      );
    } catch (err: any) {
      return reply.status(302).redirect(
        `${frontendUrl}/?error=${encodeURIComponent(err.message || 'LinkedIn connection failed')}`,
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
    const sessionUserId = req.cookies?.['la_session'];
    if (!sessionUserId) {
      return { authenticated: false, userId: null, account: null };
    }
    const accounts = await this.authService.getUserAccounts(sessionUserId);
    const activeAccount = accounts.find((acc) => acc.status === 'ACTIVE') || accounts[0] || null;

    return {
      authenticated: !!activeAccount,
      userId: activeAccount ? activeAccount.userId : sessionUserId,
      account: activeAccount ? LinkedInAccountResponseDto.fromEntity(activeAccount) : null,
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
    this.clearSessionCookie(reply);
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

    this.setSessionCookie(reply, account.userId);

    return LinkedInAccountResponseDto.fromEntity(account);
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
    const accounts = await this.authService.getUserAccounts(userId);
    return accounts.map(LinkedInAccountResponseDto.fromEntity);
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
    @Param('accountId') accountId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LinkedInAccountResponseDto> {
    const account = await this.authService.disconnectAccount(accountId);
    this.clearSessionCookie(reply);
    return LinkedInAccountResponseDto.fromEntity(account);
  }
}

