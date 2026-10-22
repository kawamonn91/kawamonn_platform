import { useEffect, useRef, useState } from 'react';
import {
    ActionIcon, AspectRatio, Card, Center, Grid, Group, Menu, Stack, Text,
} from '@mantine/core';
import {
    IconDotsVertical, IconDownload, IconFile, IconFileCode,
    IconFileText, IconFileZip, IconFolder, IconPhoto, IconTrash,
} from '@tabler/icons-react';
import * as pdfjsLib from 'pdfjs-dist';
import { formatBytes, isPreviewable } from '../api/files';
import { type StorageEntry, readFileBytes } from '../api/storage';

// サムネイルのために丸ごと読み込むのは、この大きさまで(大きい写真や PDF が並ぶフォルダで重くならないように)
const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;

function getFileIcon(mime: string, size = 48) {
    if (mime === 'directory') return <IconFolder size={size} color="#4dabf7" />;
    if (mime.startsWith('image/')) return <IconPhoto size={size} color="#f59f00" />;
    if (mime.startsWith('video/')) return <IconFile size={size} color="#e64980" />;
    if (mime.startsWith('text/')) return <IconFileCode size={size} color="#74c0fc" />;
    if (mime.includes('pdf')) return <IconFileText size={size} color="#e64980" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz')) return <IconFileZip size={size} color="#a9e34b" />;
    return <IconFileText size={size} color="#adb5bd" />;
}

export interface FileCardProps {
    entry: StorageEntry;
    onOpen: (entry: StorageEntry) => void;
    onDownload: (entry: StorageEntry) => void;
    onDelete: (entry: StorageEntry) => void;
}

export default function FileCard({ entry, onOpen, onDownload, onDelete }: FileCardProps) {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(
        () => typeof IntersectionObserver === 'undefined',
    );

    useEffect(() => {
        if (visible || typeof IntersectionObserver === 'undefined') return;
        const el = cardRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '200px' },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [visible]);

    useEffect(() => {
        if (!visible) return;
        let objectUrl: string | null = null;
        let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
        let cancelled = false;

        const loadThumb = async () => {
            if (!isPreviewable(entry.mime) || entry.size > THUMBNAIL_MAX_BYTES) return;
            try {
                const data = await readFileBytes(entry.path);
                if (cancelled) return;

                if (entry.mime.startsWith('image/')) {
                    objectUrl = URL.createObjectURL(new Blob([data], { type: entry.mime }));
                    setThumbUrl(objectUrl);
                } else {
                    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
                    pdfDoc = pdf;
                    if (cancelled) {
                        void pdf.destroy();
                        pdfDoc = null;
                        return;
                    }
                    const page = await pdf.getPage(1);
                    if (cancelled) {
                        void pdf.destroy();
                        pdfDoc = null;
                        return;
                    }

                    const vp0 = page.getViewport({ scale: 1 });
                    const scale = 200 / Math.max(vp0.width, vp0.height);
                    const vp = page.getViewport({ scale });

                    const canvas = document.createElement('canvas');
                    canvas.width = vp.width;
                    canvas.height = vp.height;
                    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
                    if (!cancelled) setThumbUrl(canvas.toDataURL());
                    void pdf.destroy();
                    pdfDoc = null;
                }
            } catch (e) {
                console.error('Thumbnail load failed:', e);
            }
        };

        void loadThumb();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            if (pdfDoc) void pdfDoc.destroy();
        };
    }, [visible, entry.path, entry.mime, entry.size]);

    return (
        <Grid.Col span={{ base: 6, sm: 4, md: 3, lg: 2, xl: 2 }}>
            <Card
                ref={cardRef}
                shadow="xs"
                padding={0}
                radius="md"
                withBorder
                h="100%"
                style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
                onClick={() => onOpen(entry)}
            >
                <Card.Section>
                    <AspectRatio
                        ratio={4 / 3}
                        bg="var(--mantine-color-gray-0, #f8f9fa)"
                        style={{ overflow: 'hidden', borderBottom: '1px solid var(--mantine-color-gray-2)' }}
                    >
                        {thumbUrl ? (
                            <img
                                src={thumbUrl}
                                alt={entry.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        ) : (
                            <Center style={{ width: '100%', height: '100%' }}>
                                {getFileIcon(entry.mime, 64)}
                            </Center>
                        )}
                    </AspectRatio>
                </Card.Section>

                <Group justify="space-between" wrap="nowrap" p="xs" style={{ flexGrow: 1, alignItems: 'flex-start' }}>
                    <Stack gap={2} style={{ overflow: 'hidden' }}>
                        <Text fw={500} size="sm" truncate title={entry.name}>
                            {entry.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                            {formatBytes(entry.size)}
                        </Text>
                    </Stack>
                    <Menu shadow="md" width={140} position="bottom-end" withinPortal>
                        <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => e.stopPropagation()}>
                                <IconDotsVertical size={16} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item
                                leftSection={<IconDownload size={14} />}
                                onClick={(e) => { e.stopPropagation(); onDownload(entry); }}
                            >
                                ダウンロード
                            </Menu.Item>
                            <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={14} />}
                                onClick={(e) => { e.stopPropagation(); onDelete(entry); }}
                            >
                                削除
                            </Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Card>
        </Grid.Col>
    );
}
