import { Controller, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @HttpCode(HttpStatus.CREATED)
    @Post('register')
    @Throttle({ auth: { limit: 5, ttl: 60000 } })
    register(@Body() registerDto: RegisterDto & { otp_code?: string }) {
        return this.authService.register(registerDto);
    }


    @HttpCode(HttpStatus.OK)
    @Post('login')
    @Throttle({ auth: { limit: 10, ttl: 60000 } })
    login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @HttpCode(HttpStatus.OK)
    @Post('send-otp')
    @Throttle({ auth: { limit: 3, ttl: 60000 } })
    sendOtp(@Body() body: { email: string }) {
        return this.authService.sendOtp(body.email);
    }

    @HttpCode(HttpStatus.OK)
    @Post('admin/login')
    @Throttle({ auth: { limit: 5, ttl: 60000 } })
    adminLogin(@Body() loginDto: LoginDto) {
        return this.authService.adminLogin(loginDto);
    }

    @HttpCode(HttpStatus.OK)
    @Post('admin/verify')
    adminVerify(@Body() body: { account_name: string, otp_code: string }) {
        return this.authService.adminVerify(body.account_name, body.otp_code);
    }

    @HttpCode(HttpStatus.OK)
    @Post('forgot-password')
    @Throttle({ auth: { limit: 3, ttl: 60000 } })
    forgotPassword(@Body() body: { email: string }, @Req() req: Request) {
        const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
        return this.authService.forgotPassword(body.email, ip);
    }

    @HttpCode(HttpStatus.OK)
    @Post('h1_JMT48RY-eJkeeVQwib5gvOwRFWNYswkOzBofQ')
    resetPassword(@Body() body: { token: string, new_password: string }, @Req() req: Request) {
        const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
        return this.authService.resetPassword(body.token, body.new_password, ip);
    }
}
