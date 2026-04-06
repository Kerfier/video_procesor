import { type FormEvent, useState } from 'react';
import type { StreamParams } from '../../api/streamsApi';
import { ALLOWED_MIME_TYPES } from '../../constants/file';
import { useAdvancedSettings } from '../../hooks/useAdvancedSettings';
import { useFileInput } from '../../hooks/useFileInput';
import { AdvancedSettings } from './AdvancedSettings';
import styles from './FileUpload.module.css';

interface FileUploadProps {
  onSubmit: (file: File, params: StreamParams | null) => Promise<void>;
  isLoading: boolean;
  disabled?: boolean;
}

export function FileUpload({ onSubmit, isLoading, disabled }: FileUploadProps) {
  const { file, isDragOver, inputRef, dragHandlers, handleFileChange, formattedSize, formatError } =
    useFileInput();
  const { params, setParams, showAdvanced, toggleAdvanced } = useAdvancedSettings();
  const [raw, setRaw] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || isLoading || disabled) return;
    void onSubmit(file, raw ? null : params);
  };

  const handleOpenFilePicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div
        className={`${styles.dropZone} ${isDragOver && !disabled ? styles.dragOver : ''} ${file ? styles.hasFile : ''} ${disabled ? styles.disabled : ''}`}
        {...(!disabled ? dragHandlers : {})}
        onClick={handleOpenFilePicker}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleOpenFilePicker();
        }}
        aria-label="Drop video file or click to select"
        aria-disabled={disabled}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_MIME_TYPES}
          className={styles.hiddenInput}
          onChange={handleFileChange}
          tabIndex={-1}
          disabled={disabled}
        />

        {file ? (
          <div className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{formattedSize}</span>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.dropIcon}>⬆</span>
            <span className={styles.dropLabel}>Drop a video file or click to browse</span>
            <span className={styles.dropHint}>MP4, MOV, MKV, AVI</span>
          </div>
        )}
      </div>

      {formatError && <p className={styles.formatError}>{formatError}</p>}

      <div className={styles.actions}>
        <label className={styles.rawToggle}>
          <input
            type="checkbox"
            checked={raw}
            onChange={(e) => setRaw(e.target.checked)}
            disabled={disabled}
          />
          Raw passthrough (no processing)
        </label>

        {!raw && (
          <button
            type="button"
            className={styles.advancedToggle}
            onClick={toggleAdvanced}
            aria-expanded={showAdvanced}
          >
            <span className={styles.chevron} data-open={showAdvanced}>
              ▸
            </span>
            Advanced settings
          </button>
        )}

        <button
          className={styles.submitBtn}
          type="submit"
          disabled={!file || isLoading || disabled}
          aria-busy={isLoading}
        >
          {isLoading ? <span className={styles.spinner} aria-hidden="true" /> : null}
          {isLoading ? 'Uploading…' : raw ? 'Stream' : 'Process'}
        </button>
      </div>

      {!raw && showAdvanced && <AdvancedSettings value={params} onChange={setParams} />}
    </form>
  );
}
