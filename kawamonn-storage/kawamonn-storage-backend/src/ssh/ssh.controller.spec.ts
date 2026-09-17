import { Test, TestingModule } from '@nestjs/testing';
import { SshController } from './ssh.controller';
import { SshService } from './ssh.service';

const mockSshService = {
  provisionContainer: jest.fn(),
  getStatus: jest.fn(),
};

describe('SshController', () => {
  let controller: SshController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SshController],
      providers: [{ provide: SshService, useValue: mockSshService }],
    }).compile();

    controller = module.get<SshController>(SshController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
