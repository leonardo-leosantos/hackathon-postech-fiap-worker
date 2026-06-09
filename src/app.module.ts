import { Module } from '@nestjs/common';
import { HealthModule } from 'src/infra/http/modules/health/health.module';

@Module({
  imports: [HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
