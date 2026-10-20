import { describe, it, expect } from 'vitest';
import { createLatestTracker } from './latest';

describe('createLatestTracker', () => {
    it('後から頼んだものがあれば、先に頼んだものは最新ではない', () => {
        const t = createLatestTracker();
        const first = t.next();
        const second = t.next();
        expect(t.isLatest(first)).toBe(false);
        expect(t.isLatest(second)).toBe(true);
    });

    it('先に頼んだ読み込みの結果が後から届いても、後に頼んだ結果を上書きしない', async () => {
        const t = createLatestTracker();
        let shown = '';
        const load = async (value: string, delayMs: number) => {
            const id = t.next();
            await new Promise((r) => setTimeout(r, delayMs));
            if (t.isLatest(id)) shown = value;
        };
        await Promise.all([load('root', 30), load('docs', 5)]);
        expect(shown).toBe('docs');
    });
});
