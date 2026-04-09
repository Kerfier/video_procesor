import type { StreamParams } from './api/streamsApi';
import { useStream } from './hooks/useStream';
import { InputPanel } from './components/InputPanel/InputPanel';
import { StatusBadge } from './components/StatusBadge/StatusBadge';
import { StreamPlayer } from './components/StreamPlayer/StreamPlayer';
import styles from './App.module.css';

function App() {
  const {
    streamId,
    statusResponse,
    isLoading,
    startError,
    hasEnoughSegments,
    startUrl,
    uploadFile,
    uploadRawFile,
    stop,
  } = useStream();

  const handleUpload = (file: File, params: StreamParams | null) =>
    params === null ? uploadRawFile(file) : uploadFile(file, params);

  const isProcessing =
    streamId !== null && statusResponse?.status !== 'done' && statusResponse?.status !== 'error';

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>video-processor</h1>
          <p className={styles.subtitle}>Blur faces and license plates in real-time HLS streams</p>
        </header>

        <InputPanel
          onStartUrl={startUrl}
          onUploadFile={handleUpload}
          isLoading={isLoading}
          disabled={isLoading || isProcessing}
        />

        {startError && <p className={styles.startError}>{startError}</p>}

        {statusResponse && (
          <StatusBadge
            status={statusResponse.status}
            segmentCount={statusResponse.segmentCount}
            error={statusResponse.error}
          />
        )}

        {streamId && hasEnoughSegments && (
          <StreamPlayer
            streamId={streamId}
            status={statusResponse?.status ?? 'processing'}
            onStop={() => void stop()}
          />
        )}
      </div>
    </div>
  );
}

export default App;
