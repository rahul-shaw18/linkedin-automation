import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('System & Health')
@Controller('health')
export class HealthController {
  private lastDbCheckTime = 0;
  private cachedDbStatus = 'unknown';
  private readonly DB_CACHE_TTL_MS = 5000;

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Service health and uptime check',
    description:
      'Returns uptime, server time, environment mode, and database connection status with 5s TTL caching. Used by Render health probes and uptime monitors.',
  })
  @ApiResponse({
    status: 200,
    description: 'System health report',
  })
  async getHealth() {
    const now = Date.now();
    let databaseStatus = this.cachedDbStatus;

    if (now - this.lastDbCheckTime > this.DB_CACHE_TTL_MS) {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        databaseStatus = 'connected';
      } catch {
        databaseStatus = 'unreachable';
      }
      this.cachedDbStatus = databaseStatus;
      this.lastDbCheckTime = now;
    }

    return {
      status: 'ok',
      service: 'linkedin-automation-engine',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      database: databaseStatus,
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }
}

