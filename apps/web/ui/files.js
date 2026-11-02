// Attachments: images, PDFs and plain text, checked here and again on the server.

export const MAX_FILES = 3;
export const MAX_TOTAL = 3000000;
export const MAX_TEXT = 200000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|sql|ya?ml|toml|ini|log)$/i;
export const ACCEPT = IMAGE_TYPES.join(',') + ',application/pdf,text/*,' + TEXT_EXT.source.match(/\(([^)]*)\)/)[1].split('|').map((e) => '.' + e.replace('ya?ml', 'yaml')).join(',') + ',.yml';
export const KIND_LABELS = { image: 'Image', pdf: 'PDF', text: 'File' };

export function classify(file) {
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXT.test(file.name)) return 'text';
  return null;
}

export function formatSize(bytes) {
  return bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? Math.round(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
}

export function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// A small preview, so chats never hold a full-size image data URL in the page.
export async function makeThumb(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, (size - bitmap.width * scale) / 2, (size - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    return '';
  }
}
