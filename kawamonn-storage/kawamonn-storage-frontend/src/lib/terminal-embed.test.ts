import { describe, expect, it, vi } from 'vitest';
import { embedParentOrigins, parseHostMessage, postStateToParent, sanitizePaste } from './terminal-embed';

describe('embedParentOrigins', () => {
    it('allows only the labs site unless told otherwise', () => {
        expect(embedParentOrigins(undefined)).toEqual(['https://labs.kawamonn.com']);
        expect(embedParentOrigins('')).toEqual(['https://labs.kawamonn.com']);
        expect(embedParentOrigins('https://labs.kawamonn.com, http://localhost:5173')).toEqual([
            'https://labs.kawamonn.com',
            'http://localhost:5173',
        ]);
    });
});

describe('parseHostMessage', () => {
    it('accepts paste, connect and focus from the host', () => {
        expect(parseHostMessage({ source: 'ttech-terminal-host', type: 'paste', text: 'ls' })).toEqual({
            source: 'ttech-terminal-host',
            type: 'paste',
            text: 'ls',
        });
        expect(parseHostMessage({ source: 'ttech-terminal-host', type: 'connect' })?.type).toBe('connect');
    });

    it('ignores anything else', () => {
        expect(parseHostMessage(null)).toBeNull();
        expect(parseHostMessage('paste')).toBeNull();
        expect(parseHostMessage({ source: 'other', type: 'paste', text: 'ls' })).toBeNull();
        expect(parseHostMessage({ source: 'ttech-terminal-host', type: 'paste', text: 1 })).toBeNull();
        expect(parseHostMessage({ source: 'ttech-terminal-host', type: 'run' })).toBeNull();
    });
});

describe('sanitizePaste', () => {
    it('keeps newlines and tabs but drops the trailing newline', () => {
        expect(sanitizePaste("cat > a <<'EOF'\r\n\thello\r\nEOF\n\n")).toBe("cat > a <<'EOF'\n\thello\nEOF");
    });

    it('removes escape sequences and other control characters', () => {
        expect(sanitizePaste('ls\u001b[201~; rm -rf ~\u0003\u0007')).toBe('ls[201~; rm -rf ~');
    });

    it('cuts very long text', () => {
        expect(sanitizePaste('a'.repeat(30000))).toHaveLength(20000);
    });
});

describe('postStateToParent', () => {
    it('posts only to the allowed origins', () => {
        const postMessage = vi.fn();
        const parent = { postMessage } as unknown as Window;
        vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
        postStateToParent('connected', ['https://labs.kawamonn.com']);
        expect(postMessage).toHaveBeenCalledWith({ source: 'ttech-terminal', type: 'state', state: 'connected' }, 'https://labs.kawamonn.com');
        vi.restoreAllMocks();
    });
});
