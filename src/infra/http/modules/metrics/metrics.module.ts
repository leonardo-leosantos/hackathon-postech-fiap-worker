import { Global, Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeHistogramProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';

export const METRIC_VIDEO_PROCESSING_DURATION =
  'video_processing_duration_seconds';
export const METRIC_VIDEO_PROCESSING_TOTAL = 'video_processing_total';

const videoProcessingDurationProvider = makeHistogramProvider({
  name: METRIC_VIDEO_PROCESSING_DURATION,
  help: 'Duration of video processing steps',
  labelNames: ['step', 'status'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
});

const videoProcessingTotalProvider = makeCounterProvider({
  name: METRIC_VIDEO_PROCESSING_TOTAL,
  help: 'Total number of video processing outcomes',
  labelNames: ['status'],
});

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [videoProcessingDurationProvider, videoProcessingTotalProvider],
  exports: [
    PrometheusModule,
    videoProcessingDurationProvider,
    videoProcessingTotalProvider,
  ],
})
export class MetricsModule {}
