import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const mockUsersService = {
  findOne: jest.fn(),
  changePassword: jest.fn(),
  deleteAccount: jest.fn(),
};

const me = {
  id: 'u1',
  account_name: 'alice',
  email: 'alice@u-aizu.ac.jp',
  role: 'user',
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('新しいパスワードが無ければ何もしない', async () => {
    await expect(controller.updateMe(me, {})).resolves.toEqual({
      status: '変更なし',
    });
    expect(mockUsersService.changePassword).not.toHaveBeenCalled();
  });

  it('今のパスワードが無ければ断る', async () => {
    await expect(
      controller.updateMe(me, { new_password: 'new password!' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('パスワードの変更と、アカウントの削除はサービスに任せる', async () => {
    await controller.updateMe(me, {
      current_password: 'old',
      new_password: 'new password!',
    });
    expect(mockUsersService.changePassword).toHaveBeenCalledWith(
      'u1',
      'old',
      'new password!',
    );
    await controller.deleteMe(me);
    expect(mockUsersService.deleteAccount).toHaveBeenCalledWith('u1');
  });
});
