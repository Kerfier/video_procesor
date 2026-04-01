import { useState } from 'react';
import type { StreamParams } from '../../api/streamsApi';
import { UrlInput } from './UrlInput';
import { FileUpload } from './FileUpload';
import styles from './InputPanel.module.css';

type Tab = 'url' | 'file';

interface InputPanelProps {
  onStartUrl: (url: string, params: StreamParams) => Promise<void>;
  onUploadFile: (file: File, params: StreamParams) => Promise<void>;
  isLoading: boolean;
}

export function InputPanel({ onStartUrl, onUploadFile, isLoading }: InputPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('url');

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          className={styles.tab}
          aria-selected={activeTab === 'url'}
          data-active={activeTab === 'url'}
          onClick={() => setActiveTab('url')}
          disabled={isLoading}
        >
          URL
        </button>
        <button
          role="tab"
          className={styles.tab}
          aria-selected={activeTab === 'file'}
          data-active={activeTab === 'file'}
          onClick={() => setActiveTab('file')}
          disabled={isLoading}
        >
          File Upload
        </button>
        <div
          className={styles.tabIndicator}
          style={{ transform: `translateX(${activeTab === 'url' ? '0' : '100%'})` }}
        />
      </div>

      <div className={styles.content}>
        {activeTab === 'url' ? (
          <UrlInput onSubmit={onStartUrl} isLoading={isLoading} />
        ) : (
          <FileUpload onSubmit={onUploadFile} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}
