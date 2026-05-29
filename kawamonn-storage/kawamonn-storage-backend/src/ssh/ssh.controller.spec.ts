import { Test, TestingModule } from '@nestjs/testing';
import { SshController } from './ssh.controller';

describe('SshController', () => {
  let controller: SshController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SshController],
    }).compile();

    controller = module.get<SshController>(SshController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
