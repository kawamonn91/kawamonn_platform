import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(user: any): ExecutionContext {
    return {
        getHandler: () => ({}) as any,
        getClass: () => ({}) as any,
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
    let reflector: { getAllAndOverride: jest.Mock };
    let guard: RolesGuard;

    beforeEach(() => {
        reflector = { getAllAndOverride: jest.fn() };
        guard = new RolesGuard(reflector as unknown as Reflector);
    });

    it('allows the request when the route has no @Roles() metadata', () => {
        reflector.getAllAndOverride.mockReturnValue(undefined);
        expect(guard.canActivate(makeContext({ role: 'user' }))).toBe(true);
    });

    it('allows the request when the metadata is an empty array', () => {
        reflector.getAllAndOverride.mockReturnValue([]);
        expect(guard.canActivate(makeContext({ role: 'user' }))).toBe(true);
    });

    it('allows the request when the user role matches a required role', () => {
        reflector.getAllAndOverride.mockReturnValue(['admin']);
        expect(guard.canActivate(makeContext({ role: 'admin' }))).toBe(true);
    });

    it('rejects the request when the user role does not match', () => {
        reflector.getAllAndOverride.mockReturnValue(['admin']);
        expect(() => guard.canActivate(makeContext({ role: 'user' }))).toThrow(ForbiddenException);
    });

    it('rejects the request when there is no user on the request at all', () => {
        reflector.getAllAndOverride.mockReturnValue(['admin']);
        expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
    });
});
