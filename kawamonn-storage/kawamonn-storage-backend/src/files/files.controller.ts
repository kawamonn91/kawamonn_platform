import { Controller, Post, Get, Delete, Put, UseGuards, UseInterceptors, UploadedFile, Request, Query, Body, Param, Res, UnauthorizedException } from '@nestjs/common';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from '../common/jwt-secret';
import * as jwt from 'jsonwebtoken';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
    constructor(private readonly filesService: FilesService, private readonly prisma: PrismaService) { }

    @Post()
    @UseInterceptors(FileInterceptor('file'))
    uploadFile(@UploadedFile() file: Express.Multer.File, @Request() req, @Body('parent_id') parentId?: string) {
        return this.filesService.uploadFile(req.user.id, file, parentId);
    }

    @Post('folder')
    createFolder(@Body() body: { name: string, parent_id?: string }, @Request() req) {
        return this.filesService.createFolder(req.user.id, body.name, body.parent_id);
    }

    @Post('text')
    createTextFile(@Body() body: { name: string, content: string, parent_id?: string }, @Request() req) {
        return this.filesService.createTextFile(req.user.id, body.name, body.content, body.parent_id);
    }

    @Put(':id/content')
    updateContent(@Param('id') id: string, @Body('content') content: string, @Request() req) {
        const buffer = Buffer.from(content || '', 'utf8');
        return this.filesService.updateFileContent(req.user.id, id, buffer);
    }

    @Get()
    listFiles(
        @Request() req,
        @Query('page') page: string = '1',
        @Query('per_page') perPage: string = '20',
        @Query('q') q?: string,
        @Query('parent_id') parentId: string = 'null',
    ) {
        const pid = parentId === 'null' ? null : parentId;
        return this.filesService.listFiles(
            req.user.id,
            parseInt(page, 10),
            parseInt(perPage, 10),
            q,
            pid
        );
    }

    @Get(':id/download')
    async getDownloadUrl(@Param('id') id: string, @Request() req) {
        const url = await this.filesService.getDownloadUrl(req.user.id, id);
        return { url };
    }

    @Delete(':id')
    async deleteFile(@Param('id') id: string, @Request() req) {
        return this.filesService.deleteFile(req.user.id, id);
    }

    /**
     * Stream endpoint – bypasses class-level JwtAuthGuard so it accepts
     * ?token= query param (needed because <img src> cannot set Authorization headers).
     */
    @Get(':id/stream')
    @UseGuards() // intentionally bypass JwtAuthGuard to allow query-param token
    async streamFile(
        @Param('id') id: string,
        @Request() req,
        @Query('token') queryToken: string,
        @Res() res: any,
    ) {
        let userId: string;
        try {
            // Accept JWT from Authorization header OR from ?token= query param
            const rawToken = (req.headers?.authorization || '').replace('Bearer ', '') || queryToken;
            if (!rawToken) throw new Error('No token provided');
            const payload: any = jwt.verify(rawToken, getJwtSecret());
            // Unlike JwtAuthGuard's normal path, this endpoint bypasses JwtStrategy,
            // so it must independently confirm the user hasn't been deleted since
            // the token was issued.
            const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
            if (!user) throw new Error('User no longer exists');
            userId = user.id;
        } catch {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        try {
            const { stream, mime_type, name } = await this.filesService.streamFile(userId, id);
            res.setHeader('Content-Type', mime_type);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
            res.setHeader('Cache-Control', 'private, max-age=3600');
            stream.pipe(res);
        } catch (e: any) {
            res.status(404).json({ message: e.message || 'File not found' });
        }
    }
}
