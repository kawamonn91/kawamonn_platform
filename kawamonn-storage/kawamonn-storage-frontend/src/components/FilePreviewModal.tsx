import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Center, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDownload } from '@tabler/icons-react';
import * as pdfjsLib from 'pdfjs-dist';
import { type StorageEntry, readFileBytes } from '../api/storage';

export interface FilePreviewModalProps {
    entry: StorageEntry | null;
    onClose: () => void;
    onDownload: (entry: StorageEntry) => void;
}

export default function FilePreviewModal({ entry, onClose, onDownload }: FilePreviewModalProps) {
    const isMobile = useMediaQuery('(max-width: 768px)');
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [pdfPageNum, setPdfPageNum] = useState(1);
    const [pdfTotalPages, setPdfTotalPages] = useState(1);
    const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
    const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

    const renderPdfPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
        if (!pdfCanvasRef.current) return;
        const page = await doc.getPage(pageNum);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(800 / vp0.width, 1000 / vp0.height, 1.5);
        const vp = page.getViewport({ scale });
        const canvas = pdfCanvasRef.current;
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    }, []);

    useEffect(() => {
        if (!entry) return;
        let cancelled = false;
        let createdBlobUrl: string | null = null;
        let createdPdf: pdfjsLib.PDFDocumentProxy | null = null;

        const loadPreview = async () => {
            setLoading(true);
            setBlobUrl(null);
            setPdfPageNum(1);
            setPdfTotalPages(1);
            try {
                const data = await readFileBytes(entry.path);
                if (cancelled) return;
                if (entry.mime.startsWith('image/')) {
                    createdBlobUrl = URL.createObjectURL(new Blob([data], { type: entry.mime }));
                    setBlobUrl(createdBlobUrl);
                } else if (entry.mime === 'application/pdf') {
                    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
                    if (cancelled) {
                        void pdf.destroy();
                        return;
                    }
                    createdPdf = pdf;
                    pdfDocRef.current = pdf;
                    setPdfTotalPages(pdf.numPages);
                    setTimeout(() => {
                        if (!cancelled && pdfCanvasRef.current) {
                            void renderPdfPage(pdf, 1);
                        }
                    }, 50);
                }
            } catch (e) {
                console.error('Preview failed:', e);
                if (!cancelled) {
                    alert('プレビューの読み込みに失敗しました');
                    onClose();
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadPreview();
        return () => {
            cancelled = true;
            if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
            if (createdPdf) {
                void createdPdf.destroy();
                if (pdfDocRef.current === createdPdf) pdfDocRef.current = null;
            }
        };
    }, [entry, onClose, renderPdfPage]);

    const handlePdfPageChange = async (newPage: number) => {
        const doc = pdfDocRef.current;
        if (!doc || newPage < 1 || newPage > pdfTotalPages) return;
        setPdfPageNum(newPage);
        await renderPdfPage(doc, newPage);
    };

    return (
        <Modal
            opened={entry !== null}
            onClose={onClose}
            title={entry?.name}
            size="xl"
            fullScreen={isMobile}
            styles={{
                title: { fontWeight: 600 },
                body: { padding: '12px' },
            }}
        >
            {loading ? (
                <Center h={300}><Progress value={100} animated style={{ width: '80%' }} /></Center>
            ) : entry?.mime.startsWith('image/') ? (
                <Stack align="center" gap="md">
                    <img
                        src={blobUrl ?? ''}
                        alt={entry.name}
                        style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }}
                    />
                    <Button
                        leftSection={<IconDownload size={16} />}
                        onClick={() => onDownload(entry)}
                    >
                        ダウンロード
                    </Button>
                </Stack>
            ) : entry?.mime === 'application/pdf' ? (
                <Stack align="center" gap="md">
                    <canvas
                        ref={pdfCanvasRef}
                        style={{ maxWidth: '100%', border: '1px solid #dee2e6', borderRadius: 4 }}
                    />
                    <Group gap="sm">
                        <Button
                            variant="default"
                            size="sm"
                            disabled={pdfPageNum <= 1}
                            onClick={() => void handlePdfPageChange(pdfPageNum - 1)}
                        >
                            ◀ 前のページ
                        </Button>
                        <Text size="sm">{pdfPageNum} / {pdfTotalPages}</Text>
                        <Button
                            variant="default"
                            size="sm"
                            disabled={pdfPageNum >= pdfTotalPages}
                            onClick={() => void handlePdfPageChange(pdfPageNum + 1)}
                        >
                            次のページ ▶
                        </Button>
                        <Button
                            leftSection={<IconDownload size={16} />}
                            size="sm"
                            onClick={() => onDownload(entry)}
                        >
                            ダウンロード
                        </Button>
                    </Group>
                </Stack>
            ) : null}
        </Modal>
    );
}
