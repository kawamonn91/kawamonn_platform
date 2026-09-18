import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMeDto } from './update-me.dto';

describe('UpdateMeDto', () => {
    it('accepts an empty payload (no-op update)', async () => {
        const errors = await validate(plainToInstance(UpdateMeDto, {}));
        expect(errors).toHaveLength(0);
    });

    it('accepts a valid password change, including symbols', async () => {
        const errors = await validate(
            plainToInstance(UpdateMeDto, { current_password: 'old', new_password: 'new password!' }),
        );
        expect(errors).toHaveLength(0);
    });

    it('rejects a new_password shorter than 8 characters', async () => {
        const errors = await validate(plainToInstance(UpdateMeDto, { new_password: 'short' }));
        expect(errors.some((e) => e.property === 'new_password')).toBe(true);
    });

    it('has no account_name field (renaming is intentionally unsupported)', async () => {
        // Mirrors the app's global ValidationPipe({ whitelist: true }): a field with
        // no validator decorators on the DTO is flagged as non-whitelisted.
        const errors = await validate(
            plainToInstance(UpdateMeDto, { account_name: 'newname', new_password: 'irrelevant1' }),
            { whitelist: true, forbidNonWhitelisted: true },
        );
        expect(errors.some((e) => e.property === 'account_name')).toBe(true);
    });
});
