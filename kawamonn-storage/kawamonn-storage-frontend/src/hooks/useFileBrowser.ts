import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../api/client';
import { fetchWithRetry, saveBytesAs } from '../api/files';
import { createLatestTracker } from '../api/latest';
import {
    type StorageEntry,
    buildBreadcrumbs,
    listEntries,
    readFileBytes,
    readFileText,
    saveErrorMessage,
    writeText,
} from '../api/storage';

export interface UseFileBrowserOptions {
    rootLabel?: string;
    retryReads?: boolean;
    onAfterRefresh?: () => void;
    onError?: (msg: string) => void;
}

/**
 * ストレージ画面と SSH 画面のファイルブラウザで共有する一覧・移動・エディタ・ダウンロードの状態管理。
 */
export function useFileBrowser(options: UseFileBrowserOptions = {}) {
    const {
        rootLabel = 'マイファイル',
        retryReads = false,
        onAfterRefresh,
        onError,
    } = options;

    const [currentPath, setCurrentPath] = useState('/');
    const [entries, setEntries] = useState<StorageEntry[]>([]);
    const [loading, setLoading] = useState(false);

    // エディタ状態
    const [editorPath, setEditorPath] = useState<string | null>(null);
    const [editorContent, setEditorContent] = useState('');
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);
    const [editorIsNew, setEditorIsNew] = useState(false);

    const latestList = useRef(createLatestTracker());
    const onAfterRefreshRef = useRef(onAfterRefresh);
    onAfterRefreshRef.current = onAfterRefresh;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const fetchDir = useCallback(
        async (targetPath: string) => {
            const id = latestList.current.next();
            setLoading(true);
            try {
                const items = retryReads
                    ? await fetchWithRetry(() => listEntries(targetPath))
                    : await listEntries(targetPath);
                if (!latestList.current.isLatest(id)) return;
                setEntries(items);
                setCurrentPath(targetPath);
            } catch (e) {
                if (latestList.current.isLatest(id)) {
                    onErrorRef.current?.(
                        getErrorMessage(e, 'ディレクトリを取得できませんでした'),
                    );
                }
            } finally {
                if (latestList.current.isLatest(id)) setLoading(false);
            }
            onAfterRefreshRef.current?.();
        },
        [retryReads],
    );

    const refresh = useCallback(() => fetchDir(currentPath), [fetchDir, currentPath]);

    useEffect(() => {
        void fetchDir('/');
    }, [fetchDir]);

    const openEditor = useCallback(
        async (path: string) => {
            setEditorPath(path);
            setEditorContent('');
            setEditorIsNew(false);
            setEditorLoading(true);
            try {
                const text = retryReads
                    ? await fetchWithRetry(() => readFileText(path))
                    : await readFileText(path);
                setEditorContent(text);
            } catch (e) {
                onErrorRef.current?.(
                    getErrorMessage(e, 'ファイルの読み込みに失敗しました'),
                );
                setEditorPath(null);
            } finally {
                setEditorLoading(false);
            }
        },
        [retryReads],
    );

    const openNewEditor = useCallback((path: string, isNew = true) => {
        setEditorPath(path);
        setEditorContent('');
        setEditorIsNew(isNew);
        setEditorLoading(false);
    }, []);

    const closeEditor = useCallback(() => {
        setEditorPath(null);
    }, []);

    const saveEditor = useCallback(async () => {
        if (!editorPath) return;
        setEditorSaving(true);
        try {
            await writeText(editorPath, editorContent);
            setEditorPath(null);
            await fetchDir(currentPath);
        } catch (e) {
            onErrorRef.current?.(saveErrorMessage(e, '保存に失敗しました'));
        } finally {
            setEditorSaving(false);
        }
    }, [editorPath, editorContent, fetchDir, currentPath]);

    const downloadEntry = useCallback(async (entry: StorageEntry) => {
        try {
            saveBytesAs(entry.name, await readFileBytes(entry.path), entry.mime);
        } catch {
            onErrorRef.current?.('ダウンロードに失敗しました');
        }
    }, []);

    const crumbs = buildBreadcrumbs(currentPath, rootLabel);

    return {
        currentPath,
        entries,
        loading,
        crumbs,
        fetchDir,
        refresh,
        editorPath,
        editorContent,
        setEditorContent,
        editorLoading,
        editorSaving,
        editorIsNew,
        openEditor,
        openNewEditor,
        closeEditor,
        saveEditor,
        downloadEntry,
    };
}
