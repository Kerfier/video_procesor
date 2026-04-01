import { useStream } from './hooks/useStream';
import { InputPanel } from './components/InputPanel/InputPanel';
import { StatusBadge } from './components/StatusBadge/StatusBadge';
import { StreamPlayer } from './components/StreamPlayer/StreamPlayer';
import styles from './App.module.css';

function App() {
  const { streamId, statusResponse, isLoading, startError, startUrl, uploadFile, stop } =
    useStream();

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>video-processor</h1>
          <p className={styles.subtitle}>Blur faces and license plates in real-time HLS streams</p>
        </header>

        <InputPanel onStartUrl={startUrl} onUploadFile={uploadFile} isLoading={isLoading} />

        {startError && <p className={styles.startError}>{startError}</p>}

        {statusResponse && (
          <StatusBadge
            status={statusResponse.status}
            segmentCount={statusResponse.segmentCount}
            error={statusResponse.error}
          />
        )}

        {streamId && (statusResponse?.segmentCount ?? 0) >= 3 && (
          <StreamPlayer streamId={streamId} onStop={() => void stop()} isVisible={true} />
        )}
      </div>
    </div>
  );
}

export default App;
