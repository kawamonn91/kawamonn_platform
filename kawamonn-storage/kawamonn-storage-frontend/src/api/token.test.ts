import { describe, it, expect } from 'vitest';
import { decodeToken } from './token';

function makeToken(payload: object): string {
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const b64 = btoa(String.fromCharCode(...json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `header.${b64}.signature`;
}

describe('decodeToken', () => {
    it('トークンの中身(利用者名・役割)を読む', () => {
        expect(decodeToken(makeToken({ sub: 'u1', account_name: 'alice', role: 'user' }))).toEqual({
            sub: 'u1', account_name: 'alice', role: 'user',
        });
    });

    it('UTF-8 の文字も正しく読む', () => {
        expect(decodeToken(makeToken({ sub: 'u1', account_name: 'あいう', role: 'admin' }))?.account_name)
            .toBe('あいう');
    });

    it('壊れたトークンは null', () => {
        expect(decodeToken('not-a-token')).toBeNull();
        expect(decodeToken('a.!!!.b')).toBeNull();
        expect(decodeToken(makeToken({ hello: 'world' }))).toBeNull();
    });
});
