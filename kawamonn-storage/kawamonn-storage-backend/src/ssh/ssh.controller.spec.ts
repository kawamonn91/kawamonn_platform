import { Test, TestingModule } from '@nestjs/testing';
import { SshController } from './ssh.controller';
import { SshService } from './ssh.service';

const mockSshService = {
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

  it('コンテナを作る API は無い(端末を開いたときにだけ用意する)', () => {
    expect((controller as any).provision).toBeUndefined();
  });

  it('ほかの利用者のコンテナの状態は見られない', () => {
    expect(() =>
      controller.getStatus('bob', {
        id: 'u1',
        account_name: 'alice',
        email: 'a@example.com',
        role: 'user',
      }),
    ).toThrow('Cannot view containers for other users');
    expect(mockSshService.getStatus).not.toHaveBeenCalled();
  });
});
