import { describe, it, expect } from 'vitest';
import { isQuotaExceeded, isValidName, joinPath, parentOf, toFileItem } from './storage';

describe('storage のパスの扱い', () => {
    it('joinPath: 一番上(null と "/")とフォルダの中', () => {
        expect(joinPath(null, 'a.txt')).toBe('/a.txt');
        expect(joinPath('/', 'a.txt')).toBe('/a.txt');
        expect(joinPath('/docs', 'a.txt')).toBe('/docs/a.txt');
        expect(joinPath('/docs/', 'a.txt')).toBe('/docs/a.txt');
    });

    it('parentOf: 一番上の直下なら null', () => {
        expect(parentOf('/a.txt')).toBeNull();
        expect(parentOf('/docs/a.txt')).toBe('/docs');
        expect(parentOf('/docs/sub/')).toBe('/docs');
    });

    it('isValidName: パスになってしまう名前は使えない', () => {
        expect(isValidName('report.pdf')).toBe(true);
        expect(isValidName('日本語のファイル.txt')).toBe(true);
        for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x'.repeat(256)]) {
            expect(isValidName(bad)).toBe(false);
        }
    });

    it('toFileItem: API の1件を画面の形にする(id はパス)', () => {
        expect(
            toFileItem({
                name: 'a.pdf',
                path: '/docs/a.pdf',
                isDir: false,
                size: 10,
                mtime: '2026-10-21T00:00:00.000Z',
                mime: 'application/pdf',
            }),
        ).toEqual({
            id: '/docs/a.pdf',
            name: 'a.pdf',
            size: '10',
            mime_type: 'application/pdf',
            created_at: '2026-10-21T00:00:00.000Z',
            parent_id: '/docs',
        });
        expect(
            toFileItem({ name: 'd', path: '/d', isDir: true, size: 4096, mtime: '', mime: 'directory' })
                .mime_type,
        ).toBe('directory');
    });

    it('isQuotaExceeded: 413 だけを容量超えとみなす', () => {
        expect(isQuotaExceeded({ response: { status: 413 } })).toBe(true);
        expect(isQuotaExceeded({ response: { status: 500 } })).toBe(false);
        expect(isQuotaExceeded(new Error('x'))).toBe(false);
    });
});
