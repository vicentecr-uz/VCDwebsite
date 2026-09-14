const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);
const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v']);

export function isVideoSrc(src) {
  return VIDEO_EXTENSIONS.has(imageExtension(String(src || '').split(/[?#]/, 1)[0]));
}

export function isAcceptedVideoFile(file) {
  if (!file || !isVideoSrc(file.name)) return false;
  const mime = String(file.type || '').toLowerCase().split(';', 1)[0].trim();
  return !mime || ['video/mp4', 'video/webm', 'video/x-m4v'].includes(mime);
}

export function imageExtension(filename) {
  const value = String(filename || '').toLowerCase();
  const index = value.lastIndexOf('.');
  return index === -1 ? '' : value.slice(index);
}

export function isHeicUpload(filename, mimeType = '') {
  const mime = String(mimeType || '').toLowerCase().split(';', 1)[0].trim();
  return HEIC_EXTENSIONS.has(imageExtension(filename)) || HEIC_MIME_TYPES.has(mime);
}

export function isAcceptedImageFile(file) {
  if (!file) return false;
  const mime = String(file.type || '').toLowerCase().split(';', 1)[0].trim();
  if (mime.startsWith('image/')) return true;
  // Some browsers expose HEIC as an empty MIME type; only the known HEIC
  // extensions are allowed through in that case.
  return !mime && HEIC_EXTENSIONS.has(imageExtension(file.name));
}

export function uploadFilename(filename, mimeType = '') {
  const value = String(filename || 'image.jpg');
  if (!isHeicUpload(value, mimeType)) return value;
  const extension = imageExtension(value);
  return `${value.slice(0, -extension.length) || 'image'}.jpg`;
}
