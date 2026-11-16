import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
    it('accepts a path on this site', () => {
        expect(safeNext('/ssh')).toBe('/ssh');
    });

    it.each([null, '', 'https://example.com/', '//example.com/', '/\\example.com'])('falls back to the top for %p', (value) => {
        expect(safeNext(value)).toBe('/');
    });
});
