import { getJwtSecret } from './jwt-secret';

describe('getJwtSecret', () => {
    const originalSecret = process.env.JWT_SECRET;

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalSecret;
        }
    });

    it('throws when JWT_SECRET is unset', () => {
        delete process.env.JWT_SECRET;
        expect(() => getJwtSecret()).toThrow();
    });

    it('throws when JWT_SECRET is shorter than 16 characters', () => {
        process.env.JWT_SECRET = 'too-short';
        expect(() => getJwtSecret()).toThrow();
    });

    it('returns the secret unchanged when it is valid', () => {
        process.env.JWT_SECRET = 'a-perfectly-fine-random-secret-value';
        expect(getJwtSecret()).toBe('a-perfectly-fine-random-secret-value');
    });
});
