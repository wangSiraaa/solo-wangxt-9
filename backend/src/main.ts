import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: false }),
  );
  app.setGlobalPrefix('', { exclude: [] });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`TLS rotation backend listening on http://0.0.0.0:${port}`);
}
bootstrap();
