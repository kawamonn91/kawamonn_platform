import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';

/**
 * Deliberately does NOT import the full AppModule. AppController/AppService
 * have no real dependencies at all, but AppModule also wires up SyncModule
 * (whose SyncService starts a chokidar watcher over the real production
 * /home/pi/hdd/ssh tree on every boot — multi-minute slow on this machine and
 * entirely unrelated to this smoke test), Docker/dockerode, BullMQ, etc.
 * Scoping the module to just what this route needs keeps the suite fast.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
