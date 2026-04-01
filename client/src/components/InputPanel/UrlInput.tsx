import { type FormEvent, useState } from 'react';
import type { StreamParams } from '../../api/streamsApi';
import { AdvancedSettings } from './AdvancedSettings';
import styles from './UrlInput.module.css';

interface UrlInputProps {
  onSubmit: (url: string, params: StreamParams) => Promise<void>;
  isLoading: boolean;
}

export function UrlInput({ onSubmit, isLoading }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [params, setParams] = useState<StreamParams>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isLoading) return;
    void onSubmit(url.trim(), params);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.inputRow}>
        <input
          className={styles.urlInput}
          type="url"
          placeholder="https://example.com/stream/playlist.m3u8"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isLoading}
          aria-label="HLS stream URL"
        />
        <button
          className={styles.submitBtn}
          type="submit"
          disabled={!url.trim() || isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? <span className={styles.spinner} aria-hidden="true" /> : null}
          {isLoading ? 'Starting…' : 'Start'}
        </button>
      </div>

      <button
        type="button"
        className={styles.advancedToggle}
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
      >
        <span className={styles.chevron} data-open={showAdvanced}>▸</span>
        Advanced settings
      </button>

      {showAdvanced && <AdvancedSettings value={params} onChange={setParams} />}
    </form>
  );
}
