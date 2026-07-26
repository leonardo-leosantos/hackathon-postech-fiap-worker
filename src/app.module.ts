import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/app-config.module';
import { HealthModule } from 'src/infra/http/modules/health/health.module';
import { MetricsModule } from 'src/infra/http/modules/metrics/metrics.module';
import { VideoProcessingModule } from 'src/modules/video-processing/video-processing.module';

@Module({
  imports: [
    AppConfigModule,
    HealthModule,
    MetricsModule,
    VideoProcessingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
