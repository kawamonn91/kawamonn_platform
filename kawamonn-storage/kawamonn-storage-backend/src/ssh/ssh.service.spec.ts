import { Test, TestingModule } from '@nestjs/testing';
import { SshService } from './ssh.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    getContainer: jest.fn(),
    createContainer: jest.fn(),
  })),
);

const mockPrisma = {
  user: { findUnique: jest.fn() },
  sshContainer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
};

describe('SshService', () => {
  let service: SshService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SshService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SshService>(SshService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
