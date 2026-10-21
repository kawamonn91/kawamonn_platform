import { describe, it, expect, vi } from 'vitest';
import { formatBytes, fetchWithRetry, isEditableFile, isPreviewable } from './files';

describe('formatBytes', () => {
    it('formats zero bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes below 1KB', () => {
        expect(formatBytes(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
        expect(formatBytes(2048)).toBe('2 KB');
    });

    it('formats megabytes', () => {
        expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    });

    it('formats gigabytes', () => {
        expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2 GB');
    });
});

describe('isEditableFile', () => {
    it('treats common text/code extensions as editable', () => {
        expect(isEditableFile('notes.md')).toBe(true);
        expect(isEditableFile('script.py')).toBe(true);
        expect(isEditableFile('index.ts')).toBe(true);
        expect(isEditableFile('README')).toBe(true); // no extension -> ''
    });

    it('treats binary/media extensions as not editable', () => {
        expect(isEditableFile('photo.png')).toBe(false);
        expect(isEditableFile('archive.zip')).toBe(false);
        expect(isEditableFile('video.mp4')).toBe(false);
    });

    it('is case-insensitive on the extension', () => {
        expect(isEditableFile('SCRIPT.PY')).toBe(true);
    });

    it('MIME タイプがテキストなら、拡張子が一覧に無くても編集できる', () => {
        expect(isEditableFile('main.kt', 'text/x-kotlin')).toBe(true);
        expect(isEditableFile('data.weird', 'application/json')).toBe(true);
        expect(isEditableFile('photo.png', 'image/png')).toBe(false);
    });

    it('ストレージ画面と SSH 画面で判定がそろう(.tex や .go も編集できる)', () => {
        expect(isEditableFile('paper.tex', 'text/x-tex')).toBe(true);
        expect(isEditableFile('paper.tex')).toBe(true);
        expect(isEditableFile('main.go', 'application/octet-stream')).toBe(true);
    });
});

describe('isPreviewable', () => {
    it('画像と PDF だけ', () => {
        expect(isPreviewable('image/png')).toBe(true);
        expect(isPreviewable('application/pdf')).toBe(true);
        expect(isPreviewable('text/plain')).toBe(false);
    });
});

describe('fetchWithRetry', () => {
    it('resolves immediately on success without retrying', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await fetchWithRetry(fn, 3, 1);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on a 5xx-style error and eventually succeeds', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ response: { status: 500 } })
            .mockRejectedValueOnce({ response: { status: 503 } })
            .mockResolvedValue('ok');

        const result = await fetchWithRetry(fn, 3, 1);

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on a 4xx error other than 429, and rethrows it', async () => {
        const notFound = { response: { status: 404 } };
        const fn = vi.fn().mockRejectedValue(notFound);

        await expect(fetchWithRetry(fn, 3, 1)).rejects.toBe(notFound);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does retry on a 429 (rate limit) error', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ response: { status: 429 } })
            .mockResolvedValue('ok');

        const result = await fetchWithRetry(fn, 3, 1);

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('gives up and rethrows after exhausting all retries', async () => {
        const serverError = { response: { status: 500 } };
        const fn = vi.fn().mockRejectedValue(serverError);

        await expect(fetchWithRetry(fn, 2, 1)).rejects.toBe(serverError);
        expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    });
});
