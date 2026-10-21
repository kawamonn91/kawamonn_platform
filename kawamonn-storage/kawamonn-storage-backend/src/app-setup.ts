import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ALLOWED_ORIGINS } from './common/allowed-origins';

/**
 * JSON の本文の大きさの上限。Web のエディタはテキストを JSON で送って保存するので、
 * express の既定(100KB)では少し長いファイルも保存できなかった。
 */
export const JSON_BODY_LIMIT = '10mb';

/**
 * アプリ全体の設定。本番(main.ts)と e2e テストで同じものを使う。
 */
export function setupApp(app: NestExpressApplication): void {
  // Security headers
  app.use(helmet());

  app.setGlobalPrefix('api/v1');

  // Restrict CORS to known origins
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
