import { describe, it, expect } from 'vitest';
import {
    QUOTA_MESSAGE, TOO_LARGE_MESSAGE, isQuotaExceeded, isValidName, joinPath, parentOf, saveErrorMessage, toFileItem,
} from './storage';

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

    it('isQuotaExceeded: 容量の上限で断られた 413 だけを容量超えとみなす', () => {
        const quota = { response: { status: 413, data: { message: 'Storage quota exceeded' } } };
        expect(isQuotaExceeded(quota)).toBe(true);
        // 本文が大きすぎる 413(エディタの保存・アップロードの上限)は容量超えではない
        expect(isQuotaExceeded({ response: { status: 413, data: { message: 'request entity too large' } } })).toBe(false);
        expect(isQuotaExceeded({ response: { status: 500 } })).toBe(false);
        expect(isQuotaExceeded(new Error('x'))).toBe(false);
    });

    it('saveErrorMessage: 容量超え・大きすぎる・そのほかを言い分ける', () => {
        expect(saveErrorMessage({ response: { status: 413, data: { message: 'Storage quota exceeded' } } }, 'x'))
            .toBe(QUOTA_MESSAGE);
        expect(saveErrorMessage({ response: { status: 413, data: { message: 'File too large' } } }, 'x'))
            .toBe(TOO_LARGE_MESSAGE);
        expect(saveErrorMessage(new Error('boom'), '保存に失敗しました')).toBe('保存に失敗しました');
    });
});
