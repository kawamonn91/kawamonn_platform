import { describe, it, expect } from 'vitest';
import {
    NAME_RULE_MESSAGE, QUOTA_MESSAGE, TOO_LARGE_MESSAGE, buildBreadcrumbs,
    isQuotaExceeded, isValidName, joinPath, parentOf, saveErrorMessage, validateNewEntryName,
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

    it('validateNewEntryName: 空白除去・禁止文字・重複チェックを行う', () => {
        const entries = [
            { name: 'existing.txt', path: '/existing.txt', isDir: false, size: 1, mtime: '', mime: 'text/plain' },
        ];
        expect(validateNewEntryName('  ok.txt  ', entries)).toEqual({ name: 'ok.txt' });
        expect(validateNewEntryName('..', entries)).toEqual({ error: NAME_RULE_MESSAGE });
        expect(validateNewEntryName('existing.txt', entries)).toEqual({
            error: '「existing.txt」という名前のものがすでにあります',
        });
        expect(validateNewEntryName('existing.txt', entries, '/existing.txt')).toEqual({
            name: 'existing.txt',
        });
    });

    it('buildBreadcrumbs: パスからパンくずリストを作る', () => {
        expect(buildBreadcrumbs('/', 'マイファイル')).toEqual([{ name: 'マイファイル', path: '/' }]);
        expect(buildBreadcrumbs('/a/b', 'Home')).toEqual([
            { name: 'Home', path: '/' },
            { name: 'a', path: '/a' },
            { name: 'b', path: '/a/b' },
        ]);
    });
});
