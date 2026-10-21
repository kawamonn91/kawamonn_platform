import { useRef } from 'react';
import { Badge, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconFileText } from '@tabler/icons-react';

interface TextEditorModalProps {
    opened: boolean;
    /** 利用者フォルダの中のパス("/docs/a.txt") */
    path: string;
    content: string;
    onChange: (content: string) => void;
    onSave: () => void;
    onClose: () => void;
    loading?: boolean;
    saving?: boolean;
    /** まだ保存していない新しいファイルか */
    isNew?: boolean;
}

const SHORTCUTS = [
    { key: '^S', label: '保存 (Ctrl+S)' },
    { key: '^X', label: '閉じる (Ctrl+X)' },
    { key: 'Tab', label: 'インデント (4sp)' },
];

/**
 * テキストファイルのエディタ(nano 風の見た目とショートカット)。ストレージ画面と SSH 画面で共通。
 * Tab は次の欄へ移らず空白4つを入れ、Ctrl+S で保存、Ctrl+X で閉じる
 */
export default function TextEditorModal({
    opened, path, content, onChange, onSave, onClose, loading = false, saving = false, isNew = false,
}: TextEditorModalProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isMobile = useMediaQuery('(max-width: 768px)');

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = textareaRef.current;
            if (!ta) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const spaces = '    ';
            onChange(content.substring(0, start) + spaces + content.substring(end));
            // 入れた空白の後ろにカーソルを置く
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + spaces.length;
            });
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (!saving && !loading) onSave();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Group gap="xs">
                    <IconFileText size={14} color="#58a6ff" />
                    <Text size="sm" c="white" style={{ fontFamily: 'monospace' }}>
                        {path.split('/').pop()}
                    </Text>
                    {isNew && <Badge size="xs" color="teal">新規</Badge>}
                </Group>
            }
            size="xl"
            fullScreen={isMobile}
            closeButtonProps={{ tabIndex: -1 }}
            styles={{
                content: { background: '#0d1117', border: '1px solid #30363d' },
                header: { background: '#161b22', borderBottom: '1px solid #30363d' },
            }}
        >
            <Stack gap={0}>
                {loading ? (
                    <Stack align="center" py="xl">
                        <Loader size="sm" color="blue" />
                        <Text size="xs" c="dimmed">読み込んでいます...</Text>
                    </Stack>
                ) : (
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        aria-label="ファイルの内容"
                        style={{
                            width: '100%',
                            height: '60vh',
                            background: '#010409',
                            border: '1px solid #30363d',
                            borderRadius: 4,
                            color: '#e6edf3',
                            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                            fontSize: 13,
                            lineHeight: 1.6,
                            resize: 'vertical',
                            padding: '8px 10px',
                            outline: 'none',
                            boxSizing: 'border-box',
                            tabSize: 4,
                        }}
                        placeholder="ファイルの内容を入力..."
                        spellCheck={false}
                        autoComplete="off"
                        autoCorrect="off"
                    />
                )}

                <div style={{
                    background: '#161b22',
                    borderTop: '1px solid #30363d',
                    padding: '6px 10px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px 16px',
                    marginTop: 6,
                    borderRadius: '0 0 4px 4px',
                    alignItems: 'center',
                }}>
                    {SHORTCUTS.map(({ key, label }) => (
                        <Group key={key} gap={4} wrap="nowrap">
                            <Text
                                size="xs"
                                style={{
                                    background: '#30363d',
                                    color: '#e6edf3',
                                    fontFamily: 'monospace',
                                    padding: '1px 5px',
                                    borderRadius: 3,
                                    fontWeight: 600,
                                    fontSize: 11,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {key}
                            </Text>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{label}</Text>
                        </Group>
                    ))}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <Button variant="subtle" color="gray" size="xs" onClick={onClose} tabIndex={-1}>
                            キャンセル
                        </Button>
                        <Button
                            color="blue"
                            size="xs"
                            leftSection={<IconCheck size={13} />}
                            onClick={onSave}
                            loading={saving}
                            disabled={loading}
                            tabIndex={-1}
                        >
                            保存
                        </Button>
                    </div>
                </div>

                <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace', marginTop: 4 }}>
                    {path}
                </Text>
            </Stack>
        </Modal>
    );
}
