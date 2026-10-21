import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

const mockAdminService = {
  listUsers: jest.fn(),
  getUserDetail: jest.fn(),
  createUser: jest.fn(),
  updateEmail: jest.fn(),
  deleteUser: jest.fn(),
  resetPassword: jest.fn(),
  updateQuota: jest.fn(),
  broadcastEmail: jest.fn(),
};

const me = {
  id: 'admin-1',
  account_name: 'boss',
  email: 'boss@example.com',
  role: 'admin',
};

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('一覧の検索語は前後の空白を除き、空なら絞り込まない', () => {
    controller.listUsers('  ', '2', '10');
    expect(mockAdminService.listUsers).toHaveBeenCalledWith(undefined, 2, 10);
    controller.listUsers(' alice ');
    expect(mockAdminService.listUsers).toHaveBeenLastCalledWith('alice', 1, 50);
  });

  it('利用者を変える操作には、操作した管理者を渡す(記録に残すため)', () => {
    controller.createUser({ email: 'a@example.com' }, me);
    controller.updateUser('u1', { email: 'b@example.com' }, me);
    controller.deleteUser('u1', me);
    controller.resetPassword('u1', me);
    controller.updateQuota('u1', { quota_gb: 30 }, me);
    controller.broadcastEmail({ subject: 's', message: 'm' }, me);

    expect(mockAdminService.createUser).toHaveBeenCalledWith(
      { email: 'a@example.com' },
      me,
    );
    expect(mockAdminService.updateEmail).toHaveBeenCalledWith(
      'u1',
      'b@example.com',
      me,
    );
    expect(mockAdminService.deleteUser).toHaveBeenCalledWith('u1', me);
    expect(mockAdminService.resetPassword).toHaveBeenCalledWith('u1', me);
    expect(mockAdminService.updateQuota).toHaveBeenCalledWith('u1', 30, me);
    expect(mockAdminService.broadcastEmail).toHaveBeenCalledWith('s', 'm', me);
  });
});
