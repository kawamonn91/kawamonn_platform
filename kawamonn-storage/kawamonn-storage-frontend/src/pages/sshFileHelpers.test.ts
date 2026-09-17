import { describe, it, expect, vi } from 'vitest';
import { formatBytes, fetchWithRetry, isEditable } from './sshFileHelpers';

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

describe('isEditable', () => {
    it('treats common text/code extensions as editable', () => {
        expect(isEditable('notes.md')).toBe(true);
        expect(isEditable('script.py')).toBe(true);
        expect(isEditable('index.ts')).toBe(true);
        expect(isEditable('README')).toBe(true); // no extension -> ''
    });

    it('treats binary/media extensions as not editable', () => {
        expect(isEditable('photo.png')).toBe(false);
        expect(isEditable('archive.zip')).toBe(false);
        expect(isEditable('video.mp4')).toBe(false);
    });

    it('is case-insensitive on the extension', () => {
        expect(isEditable('SCRIPT.PY')).toBe(true);
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
