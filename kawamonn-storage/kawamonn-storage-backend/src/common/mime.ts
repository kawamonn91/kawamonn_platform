import * as path from 'path';

const MIME_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.py': 'text/x-python',
  '.c': 'text/x-csrc',
  '.h': 'text/x-chdr',
  '.cpp': 'text/x-c++src',
  '.java': 'text/x-java',
  '.sh': 'application/x-sh',
  '.csv': 'text/csv',
  '.tex': 'text/x-tex',
};

/** ファイル名(拡張子)から MIME タイプを推定する。分からなければ application/octet-stream */
export function guessMime(filename: string): string {
  return (
    MIME_BY_EXT[path.extname(filename).toLowerCase()] ||
    'application/octet-stream'
  );
}
