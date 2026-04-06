import type { StreamParams } from '../api/streamsApi';
import { ALLOWED_EXTENSIONS } from '../constants/file';

export function formatBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function getExtension(filename: string): string {
  return filename.slice(filename.lastIndexOf('.')).toLowerCase();
}

export function isAllowed(file: File): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(getExtension(file.name));
}

export function buildStreamFormData(file: File, params?: StreamParams): FormData {
  const form = new FormData();
  form.append('video', file, file.name);
  if (params) {
    if (params.detectionInterval !== undefined)
      form.append('detectionInterval', String(params.detectionInterval));
    if (params.blurStrength !== undefined) form.append('blurStrength', String(params.blurStrength));
    if (params.conf !== undefined) form.append('conf', String(params.conf));
    if (params.lookbackFrames !== undefined)
      form.append('lookbackFrames', String(params.lookbackFrames));
  }
  return form;
}
