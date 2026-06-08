export default function ReceiverScreen({
  roomId, status, peerConnected, fileName, progress, speed,
  transferComplete, downloadUrl, error, onReset
}) {
  const statusText = () => {
    switch (status) {
      case 'waiting': return 'Waiting for sender...';
      case 'connecting': return 'Establishing connection...';
      case 'connected': return 'Connected — waiting for file...';
      case 'receiving': return `Receiving: ${fileName}`;
      case 'complete': return 'Transfer complete!';
      case 'peer-disconnected': return 'Peer disconnected';
      default: return 'Setting up...';
    }
  };

  const statusClass = () => {
    if (status === 'complete') return 'status-badge status-success';
    if (status === 'receiving' || status === 'connected') return 'status-badge status-active';
    if (status === 'peer-disconnected') return 'status-badge status-error';
    return 'status-badge status-waiting';
  };

  return (
    <div className="transfer-screen">
      <div className="bg-blob blob-1" />
      <div className="bg-blob blob-2" />

      <div className="transfer-card glass-card">
        {/* Header */}
        <div className="transfer-header">
          <div className="header-left">
            <h2>Receive File</h2>
            <div className={statusClass()}>
              <span className="status-dot" />
              {statusText()}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onReset} title="Reset">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
        </div>

        {/* Room info */}
        <div className="room-code-bar">
          <span className="room-label">Room Code</span>
          <code className="room-code">{roomId}</code>
        </div>

        {/* Connection indicator */}
        <div className="peer-indicator">
          <div className={`peer-dot ${peerConnected ? 'peer-online' : 'peer-offline'}`} />
          <span>{peerConnected ? 'Sender connected' : 'Waiting for sender...'}</span>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* Waiting state */}
        {!transferComplete && status !== 'receiving' && (
          <div className="waiting-section">
            <div className="pulse-ring">
              <div className="pulse-circle" />
              <div className="pulse-circle pulse-delay-1" />
              <div className="pulse-circle pulse-delay-2" />
              <svg className="waiting-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <p className="waiting-text">
              Share the room code with the sender.
              <br />
              The file will appear here automatically.
            </p>
          </div>
        )}

        {/* Progress during receive */}
        {(status === 'receiving' || transferComplete) && (
          <div className="progress-section">
            {fileName && !transferComplete && (
              <div className="receiving-file">
                <div className="file-icon">📄</div>
                <span className="file-name">{fileName}</span>
              </div>
            )}
            <div className="progress-track">
              <div
                className={`progress-fill ${transferComplete ? 'progress-complete' : ''}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="progress-info">
              <span className="progress-percent">{progress}%</span>
              {speed > 0 && <span className="progress-speed">{speed} MB/s</span>}
            </div>
          </div>
        )}

        {/* Complete state */}
        {transferComplete && downloadUrl && (
          <div className="complete-section">
            <div className="complete-banner success-glow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>File received successfully!</span>
            </div>
            <a
              href={downloadUrl}
              download={fileName || 'download'}
              className="btn btn-primary btn-glow download-btn"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download {fileName}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
