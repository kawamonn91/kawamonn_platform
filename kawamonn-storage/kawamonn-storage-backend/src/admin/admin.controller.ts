import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { BroadcastDto } from './dto/broadcast.dto';

/** 管理画面の API。管理者(確認コードを通してログインした人)だけが使える */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('per_page') perPage = '50',
  ) {
    return this.adminService.listUsers(
      search?.trim() || undefined,
      parseInt(page, 10),
      parseInt(perPage, 10),
    );
  }

  @Get('users/:id')
  getUserDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Post('users')
  createUser(@Body() body: CreateUserDto, @CurrentUser() me: AuthUser) {
    return this.adminService.createUser(body, me);
  }

  @Put('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() me: AuthUser,
  ) {
    return this.adminService.updateEmail(id, body.email, me);
  }

  @Delete('users/:id')
  deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() me: AuthUser,
  ) {
    return this.adminService.deleteUser(id, me);
  }

  @Post('users/:id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() me: AuthUser,
  ) {
    return this.adminService.resetPassword(id, me);
  }

  @Post('users/:id/quota')
  updateQuota(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateQuotaDto,
    @CurrentUser() me: AuthUser,
  ) {
    return this.adminService.updateQuota(id, body.quota_gb, me);
  }

  @Post('broadcast')
  broadcastEmail(@Body() body: BroadcastDto, @CurrentUser() me: AuthUser) {
    return this.adminService.broadcastEmail(body.subject, body.message, me);
  }
}
