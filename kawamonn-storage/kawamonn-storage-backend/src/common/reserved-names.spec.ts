import { isReservedAccountName } from './reserved-names';

describe('isReservedAccountName', () => {
    it('rejects exact reserved names', () => {
        expect(isReservedAccountName('admin')).toBe(true);
        expect(isReservedAccountName('kawamonn-storage')).toBe(true);
        expect(isReservedAccountName('root')).toBe(true);
        expect(isReservedAccountName('ssh')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isReservedAccountName('Admin')).toBe(true);
        expect(isReservedAccountName('ROOT')).toBe(true);
        expect(isReservedAccountName('Kawamonn-Storage')).toBe(true);
    });

    it('trims surrounding whitespace before checking', () => {
        expect(isReservedAccountName('  admin  ')).toBe(true);
    });

    it('allows ordinary usernames', () => {
        expect(isReservedAccountName('alice')).toBe(false);
        expect(isReservedAccountName('toya123')).toBe(false);
        expect(isReservedAccountName('adminx')).toBe(false);
    });
});
