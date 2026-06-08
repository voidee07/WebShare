import { useRef, useState } from 'react';

const SUPPORTED_TYPES = [
  { ext: 'PDF', color: '#ef4444' },
  { ext: 'JPEG', color: '#f59e0b' },
  { ext: 'PNG', color: '#10b981' },
  { ext: 'GIF', color: '#8b5cf6' },
  { ext: 'MP4', color: '#3b82f6' },
  { ext: 'MP3', color: '#ec4899' },
  { ext: 'ZIP', color: '#6366f1' },
  { ext: 'TXT', color: '#94a3b8' },
  { ext: 'DOCX', color: '#2563eb' },
  { ext: 'XLSX', color: '#059669' },
  { ext: 'CSV', color: '#0891b2' },
];

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

export default function SenderScreen({
  roomId, status, peerConnected, file, progress, speed,
  transferComplete, error, onFileSelect, onStartTransfer, onReset, onCopyCode
}) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFileSelect(f);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (onCopyCode) onCopyCode();
  };

  const handleCopyLink = () => {
    const inviteUrl = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const statusText = () => {
    switch (status) {
      case 'waiting': return 'Waiting for peer to join...';
      case 'connecting': return 'Establishing connection...';
      case 'connected': return 'Peer connected — ready to send';
      case 'transferring': return 'Transferring file...';
      case 'complete': return 'Transfer complete!';
      case 'peer-disconnected': return 'Peer disconnected';
      default: return 'Setting up...';
    }
  };

  const statusClass = () => {
    if (status === 'complete') return 'status-badge status-success';
    if (status === 'transferring' || status === 'connected') return 'status-badge status-active';
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
            <h2>Send File</h2>
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

        {/* Room code */}
        <div className="room-code-bar vertical">
          <div className="room-info-row">
            <span className="room-label">Room Code</span>
            <div className="room-code-group">
              <code className="room-code">{roomId}</code>
              <button className="btn btn-icon-sm" onClick={handleCopy} title="Copy room code">
                {copied ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="room-info-row">
            <span className="room-label">Invite Link</span>
            <div className="room-code-group">
              <code className="room-code" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>
                {window.location.host}/?room={roomId}
              </code>
              <button className="btn btn-icon-sm" onClick={handleCopyLink} title="Copy invite link">
                {copiedLink ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {copied && <span className="copied-toast">Room code copied!</span>}
          {copiedLink && <span className="copied-toast">Invite link copied!</span>}
        </div>

        {/* Connection indicator */}
        <div className="peer-indicator">
          <div className={`peer-dot ${peerConnected ? 'peer-online' : 'peer-offline'}`} />
          <span>{peerConnected ? 'Peer connected' : 'Waiting for peer...'}</span>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* File Drop Zone */}
        {!file && !transferComplete && (
          <div
            className={`drop-zone ${isDragging ? 'drop-zone-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden-input"
              onChange={(e) => { if (e.target.files[0]) onFileSelect(e.target.files[0]); }}
            />
            <div className="drop-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className="drop-text">
              <strong>Click to choose</strong> or drag & drop a file
            </p>
            <p className="drop-hint">Max 50 MB</p>

            {/* Supported types */}
            <div className="type-chips">
              {SUPPORTED_TYPES.map((t) => (
                <span key={t.ext} className="type-chip" style={{ '--chip-color': t.color }}>
                  {t.ext}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Selected file */}
        {file && !transferComplete && (
          <div className="file-card">
            <div className="file-icon">📄</div>
            <div className="file-details">
              <span className="file-name">{file.name}</span>
              <span className="file-size">{formatBytes(file.size)}</span>
            </div>
            {status !== 'transferring' && (
              <button className="btn btn-primary btn-glow" onClick={onStartTransfer}>
                <span className="btn-icon">🚀</span>
                Send File
              </button>
            )}
          </div>
        )}

        {/* Progress */}
        {(status === 'transferring' || transferComplete) && (
          <div className="progress-section">
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

        {/* Complete */}
        {transferComplete && (
          <div className="complete-banner success-glow">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>File sent successfully!</span>
          </div>
        )}
      </div>
    </div>
  );
}
