import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { FileBrowserService, MAX_FILE_SIZE } from './filebrowser.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { Response } from 'express';

@Controller('filebrowser')
@UseGuards(JwtAuthGuard)
export class FileBrowserController {
  constructor(private readonly fileBrowserService: FileBrowserService) {}

  /** GET /api/v1/filebrowser/ls?path=/some/dir */
  @Get('ls')
  async listDir(
    @CurrentUser() me: AuthUser,
    @Query('path') relPath: string = '/',
  ) {
    const username = me.account_name;
    const entries = await this.fileBrowserService.listDir(username, relPath);
    return { path: relPath, entries };
  }

  /** GET /api/v1/filebrowser/read?path=/some/file.txt */
  @Get('read')
  async readFile(
    @CurrentUser() me: AuthUser,
    @Query('path') relPath: string,
    @Res() res: Response,
  ) {
    if (!relPath) throw new BadRequestException('path is required');
    const username = me.account_name;
    const { buffer, mime, name } = await this.fileBrowserService.readFile(
      username,
      relPath,
    );

    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  /**
   * POST /api/v1/filebrowser/upload?path=/some/dir
   * multipart/form-data: field name "file"
   */
  @Post('upload')
  // ファイルはいったんメモリに載せるので、読み込みと同じ 100MB を上限にする(超えると 413 File too large)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  async uploadFile(
    @CurrentUser() me: AuthUser,
    @Query('path') dirPath: string = '/',
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    const username = me.account_name;
    // Multer may parse non-ASCII filename as latin1
    const originalName = Buffer.from(file.originalname, 'latin1').toString(
      'utf8',
    );
    const relPath = `${dirPath === '/' ? '' : dirPath}/${originalName}`.replace(
      /\/+/g,
      '/',
    );
    await this.fileBrowserService.writeFile(username, relPath, file.buffer);
    return { success: true, path: relPath };
  }

  /** POST /api/v1/filebrowser/mkdir  body: { path: "/new/dir" } */
  @Post('mkdir')
  async mkdir(@CurrentUser() me: AuthUser, @Body('path') relPath: string) {
    if (!relPath) throw new BadRequestException('path is required');
    const username = me.account_name;
    await this.fileBrowserService.mkdir(username, relPath);
    return { success: true, path: relPath };
  }

  /**
   * PUT /api/v1/filebrowser/write-text
   * body: { path: "/file.txt", content: "..." }
   * テキストファイルをサイト上で直接作成・編集する
   */
  @Put('write-text')
  async writeText(
    @CurrentUser() me: AuthUser,
    @Body('path') relPath: string,
    @Body('content') content: string,
  ) {
    if (!relPath) throw new BadRequestException('path is required');
    const username = me.account_name;
    const buffer = Buffer.from(content ?? '', 'utf8');
    await this.fileBrowserService.writeFile(username, relPath, buffer);
    return { success: true, path: relPath };
  }

  /** DELETE /api/v1/filebrowser/delete?path=/some/file */
  @Delete('delete')
  async deleteItem(
    @CurrentUser() me: AuthUser,
    @Query('path') relPath: string,
  ) {
    if (!relPath) throw new BadRequestException('path is required');
    const username = me.account_name;
    await this.fileBrowserService.deleteItem(username, relPath);
    return { success: true };
  }

  /** PATCH /api/v1/filebrowser/rename  body: { oldPath, newPath } */
  @Patch('rename')
  async rename(
    @CurrentUser() me: AuthUser,
    @Body('oldPath') oldPath: string,
    @Body('newPath') newPath: string,
  ) {
    if (!oldPath || !newPath)
      throw new BadRequestException('oldPath and newPath are required');
    const username = me.account_name;
    await this.fileBrowserService.rename(username, oldPath, newPath);
    return { success: true };
  }
}
