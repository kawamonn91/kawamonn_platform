import * as crypto from 'crypto';
import { generateTempPassword } from './random-password';

describe('generateTempPassword', () => {
    it('defaults to length 12', () => {
        expect(generateTempPassword()).toHaveLength(12);
    });

    it('respects a custom length', () => {
        expect(generateTempPassword(20)).toHaveLength(20);
    });

    it('only uses characters from the declared charset', () => {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
        const password = generateTempPassword(64);
        for (const char of password) {
            expect(charset).toContain(char);
        }
    });

    it('is not deterministic across calls', () => {
        const a = generateTempPassword(32);
        const b = generateTempPassword(32);
        expect(a).not.toBe(b);
    });

    it('uses a CSPRNG (crypto.randomInt), not Math.random', () => {
        const spy = jest.spyOn(crypto, 'randomInt');
        generateTempPassword(8);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
