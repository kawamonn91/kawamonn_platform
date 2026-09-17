import { Test, TestingModule } from '@nestjs/testing';
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
});
