import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { NewFolderModal, RenameModal } from './FileBrowserModals';

beforeAll(() => {
    // Mantine が使う、jsdom に無い API
    window.matchMedia ??= ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

const withMantine = (ui: ReactNode) => <MantineProvider>{ui}</MantineProvider>;

describe('RenameModal', () => {
    it('元の名前から始まり、変えるまで決定できない。決定すると前後の空白を除いた名前を渡す', async () => {
        const onRename = vi.fn();
        render(withMantine(<RenameModal opened initialName="a.txt" onRename={onRename} onClose={() => {}} />));

        const input = await screen.findByLabelText('新しい名前');
        expect(input).toHaveValue('a.txt');
        expect(screen.getByRole('button', { name: '変更' })).toBeDisabled();

        await userEvent.clear(input);
        await userEvent.type(input, '  b.txt  ');
        await userEvent.click(screen.getByRole('button', { name: '変更' }));
        expect(onRename).toHaveBeenCalledWith('b.txt');
    });

    it('閉じて開き直すと、入力欄は新しい元の名前から始まる', async () => {
        const props = { onRename: vi.fn(), onClose: () => {} };
        const { rerender } = render(withMantine(<RenameModal opened initialName="a.txt" {...props} />));
        await userEvent.type(await screen.findByLabelText('新しい名前'), 'xyz');

        rerender(withMantine(<RenameModal opened={false} initialName="a.txt" {...props} />));
        await waitFor(() => expect(screen.queryByLabelText('新しい名前')).not.toBeInTheDocument());

        rerender(withMantine(<RenameModal opened initialName="c.txt" {...props} />));
        expect(await screen.findByLabelText('新しい名前')).toHaveValue('c.txt');
    });
});

describe('NewFolderModal', () => {
    it('空のままでは作成できず、Enter で決定できる', async () => {
        const onCreate = vi.fn();
        render(withMantine(<NewFolderModal opened onCreate={onCreate} onClose={() => {}} />));

        const input = await screen.findByPlaceholderText('フォルダ名');
        expect(input).toHaveValue('');
        expect(screen.getByRole('button', { name: '作成' })).toBeDisabled();

        await userEvent.type(input, 'docs{Enter}');
        expect(onCreate).toHaveBeenCalledWith('docs');
    });
});
