import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../api/client';
import { fetchWithRetry, saveBytesAs } from '../api/files';
import { createLatestTracker } from '../api/latest';
import {
    type StorageEntry,
    buildBreadcrumbs,
    deleteEntry,
    joinPath,
    listEntries,
    makeFolder,
    parentOf,
    readFileBytes,
    readFileText,
    renameEntry,
    saveErrorMessage,
    uploadFile,
    validateNewEntryName,
    writeText,
} from '../api/storage';

export interface UseFileBrowserOptions {
    rootLabel?: string;
    retryReads?: boolean;
    onAfterRefresh?: () => void;
    onError?: (msg: string) => void;
}

export interface ConfirmState {
    opened: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
}

/**
 * ストレージ画面と SSH 画面のファイルブラウザで共有する一覧・移動・エディタ・ダウンロード・作成・変更・削除・アップロードの状態管理。
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

    // アップロード進捗 (0-100, null はアイドル)
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);

    // ダイアログ状態 (Mantine Modal 用)
    const [confirmState, setConfirmState] = useState<ConfirmState>({
        opened: false,
        title: '',
        message: '',
        onConfirm: () => {},
    });
    const [renameTarget, setRenameTarget] = useState<StorageEntry | null>(null);
    const [folderModalOpened, setFolderModalOpened] = useState(false);
    const [fileModalOpened, setFileModalOpened] = useState(false);

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

    // モーダル操作ヘルパー
    const askConfirm = useCallback((title: string, message: string, onConfirm: () => void) => {
        setConfirmState({
            opened: true,
            title,
            message,
            onConfirm,
        });
    }, []);

    const closeConfirm = useCallback(() => {
        setConfirmState((prev) => ({ ...prev, opened: false }));
    }, []);

    const openRename = useCallback((target: StorageEntry) => {
        setRenameTarget(target);
    }, []);

    const closeRename = useCallback(() => {
        setRenameTarget(null);
    }, []);

    const openFolderModal = useCallback(() => setFolderModalOpened(true), []);
    const closeFolderModal = useCallback(() => setFolderModalOpened(false), []);
    const openFileModal = useCallback(() => setFileModalOpened(true), []);
    const closeFileModal = useCallback(() => setFileModalOpened(false), []);

    // フォルダ作成
    const createFolder = useCallback(async (folderName: string): Promise<boolean> => {
        const check = validateNewEntryName(folderName, entries);
        if (check.error !== undefined) {
            onErrorRef.current?.(check.error);
            return false;
        }
        try {
            await makeFolder(joinPath(currentPath, check.name));
            closeFolderModal();
            await fetchDir(currentPath);
            return true;
        } catch (e) {
            onErrorRef.current?.(saveErrorMessage(e, 'フォルダの作成に失敗しました'));
            return false;
        }
    }, [entries, currentPath, fetchDir, closeFolderModal]);

    // 新規ファイル作成
    const createFile = useCallback(async (fileName: string, content: string = ''): Promise<boolean> => {
        const check = validateNewEntryName(fileName, entries);
        if (check.error !== undefined) {
            onErrorRef.current?.(check.error);
            return false;
        }
        try {
            await writeText(joinPath(currentPath, check.name), content);
            closeFileModal();
            await fetchDir(currentPath);
            return true;
        } catch (e) {
            onErrorRef.current?.(saveErrorMessage(e, 'ファイルの作成に失敗しました'));
            return false;
        }
    }, [entries, currentPath, fetchDir, closeFileModal]);

    // 名前変更
    const rename = useCallback(async (target: StorageEntry, newName: string): Promise<boolean> => {
        if (newName.trim() === target.name) {
            closeRename();
            return true;
        }
        const check = validateNewEntryName(newName, entries, target.path);
        if (check.error !== undefined) {
            onErrorRef.current?.(check.error);
            return false;
        }
        try {
            const parent = parentOf(target.path);
            await renameEntry(target.path, joinPath(parent, check.name));
            closeRename();
            await fetchDir(currentPath);
            return true;
        } catch (e) {
            onErrorRef.current?.(getErrorMessage(e, '名前変更に失敗しました'));
            return false;
        }
    }, [entries, currentPath, fetchDir, closeRename]);

    // 削除
    const deleteItem = useCallback(async (target: StorageEntry): Promise<boolean> => {
        try {
            await deleteEntry(target.path);
            await fetchDir(currentPath);
            return true;
        } catch (e) {
            onErrorRef.current?.(getErrorMessage(e, '削除に失敗しました'));
            return false;
        }
    }, [currentPath, fetchDir]);

    // アップロード (複数ファイル対応 & 進捗追跡)
    const uploadFiles = useCallback(async (
        files: File[],
        dirOf: (file: File) => string = () => currentPath,
        labelOf: (file: File) => string = (f) => f.name,
    ): Promise<{ failed: string[]; reasons: string[] }> => {
        setUploadProgress(0);
        const failed: string[] = [];
        const reasons = new Set<string>();

        for (const [i, file] of files.entries()) {
            try {
                await uploadFile(dirOf(file), file);
            } catch (err) {
                reasons.add(saveErrorMessage(err, 'アップロードに失敗しました'));
                failed.push(labelOf(file));
            }
            setUploadProgress(Math.round(((i + 1) / files.length) * 100));
        }

        setTimeout(() => setUploadProgress(null), 800);
        await fetchDir(currentPath);

        const reasonsArray = Array.from(reasons);
        if (failed.length) {
            onErrorRef.current?.(`${failed.join(', ')} の保存に失敗しました: ${reasonsArray.join(' / ')}`);
        }
        return { failed, reasons: reasonsArray };
    }, [currentPath, fetchDir]);

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
        // ファイル操作
        createFolder,
        createFile,
        rename,
        deleteItem,
        uploadFiles,
        uploadProgress,
        // モーダル状態 & ヘルパー
        confirmState,
        askConfirm,
        closeConfirm,
        renameTarget,
        openRename,
        closeRename,
        folderModalOpened,
        openFolderModal,
        closeFolderModal,
        fileModalOpened,
        openFileModal,
        closeFileModal,
    };
}
