import { type DragEvent, useRef, useState } from 'react';
import { FORMAT_ERROR_MSG } from '../constants/file';
import { formatBytes, isAllowed } from '../utils/file';

export function useFileInput() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    if (!isAllowed(dropped)) {
      setFormatError(FORMAT_ERROR_MSG);
      return;
    }
    setFormatError(null);
    setFile(dropped);
  };

  const handleFileChange = () => {
    const selected = inputRef.current?.files?.[0];
    if (!selected) return;
    if (!isAllowed(selected)) {
      setFormatError(FORMAT_ERROR_MSG);
      return;
    }
    setFormatError(null);
    setFile(selected);
  };

  return {
    file,
    isDragOver,
    inputRef,
    dragHandlers: { onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop },
    handleFileChange,
    formattedSize: file ? formatBytes(file.size) : null,
    formatError,
  };
}
