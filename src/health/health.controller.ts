import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('System & Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Service health and uptime check',
    description: 'Returns server uptime, environment mode, and database connection status.',
  })
  @ApiResponse({
    status: 200,
    description: 'System health report',
  })
  @ApiResponse({
    status: 503,
    description: 'Database or critical dependency is unavailable',
  })
  async getHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'linkedin-automation-engine',
        timestamp: new Date().toISOString(),
        database: 'unreachable',
      });
    }

    return {
      status: 'ok',
      service: 'linkedin-automation-engine',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: this.configService.get<string>('NODE_ENV') || 'development',
      database: 'connected',
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }
}
