import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';

const mockAdminService = {
  listUsers: jest.fn(),
  getUserDetail: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  resetPassword: jest.fn(),
  updateQuota: jest.fn(),
  broadcastEmail: jest.fn(),
};

const mockAuthService = {};

const mockUsersService = {
  createUser: jest.fn(),
};

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createUser', () => {
    it.each(['..', '.', '-rf'])(
      'フォルダの外を指したりオプションに見えたりする名前 %j では作らない',
      async (account_name) => {
        await expect(
          controller.createUser({
            email: 'x@u-aizu.ac.jp',
            account_name,
          } as any),
        ).rejects.toThrow(BadRequestException);
        expect(mockUsersService.createUser).not.toHaveBeenCalled();
      },
    );

    it('名前を省くとメールアドレスの @ の前を使うが、その場合も検査する', async () => {
      await expect(
        controller.createUser({ email: '.hidden@example.com' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockUsersService.createUser).not.toHaveBeenCalled();
    });
  });
});
