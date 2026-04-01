import { type DragEvent, type FormEvent, useRef, useState } from 'react';
import type { StreamParams } from '../../api/streamsApi';
import { AdvancedSettings } from './AdvancedSettings';
import styles from './FileUpload.module.css';

interface FileUploadProps {
  onSubmit: (file: File, params: StreamParams) => Promise<void>;
  isLoading: boolean;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function FileUpload({ onSubmit, isLoading }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [params, setParams] = useState<StreamParams>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    if (dropped) setFile(dropped);
  };

  const handleFileChange = () => {
    const selected = inputRef.current?.files?.[0];
    if (selected) setFile(selected);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || isLoading) return;
    void onSubmit(file, params);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div
        className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        aria-label="Drop video file or click to select"
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className={styles.hiddenInput}
          onChange={handleFileChange}
          tabIndex={-1}
        />

        {file ? (
          <div className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{formatBytes(file.size)}</span>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.dropIcon}>⬆</span>
            <span className={styles.dropLabel}>Drop a video file or click to browse</span>
            <span className={styles.dropHint}>MP4, MOV, MKV, AVI</span>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.advancedToggle}
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          <span className={styles.chevron} data-open={showAdvanced}>▸</span>
          Advanced settings
        </button>

        <button
          className={styles.submitBtn}
          type="submit"
          disabled={!file || isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? <span className={styles.spinner} aria-hidden="true" /> : null}
          {isLoading ? 'Uploading…' : 'Process'}
        </button>
      </div>

      {showAdvanced && <AdvancedSettings value={params} onChange={setParams} />}
    </form>
  );
}
