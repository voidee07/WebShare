import { useState } from 'react';

export default function LandingScreen({ onCreateRoom, onJoinRoom }) {
  const [joinCode, setJoinCode] = useState('');

  return (
    <div className="landing-screen">
      {/* Animated background blobs */}
      <div className="bg-blob blob-1" />
      <div className="bg-blob blob-2" />
      <div className="bg-blob blob-3" />

      <div className="landing-card glass-card">
        {/* Logo / Brand */}
        <div className="brand">
          <div className="logo-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="48" y2="48">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              <rect width="48" height="48" rx="14" fill="url(#logoGrad)" />
              <path d="M16 28L24 20L32 28" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M24 20V34" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M14 16H34" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="app-title">WebShare</h1>
          <p className="app-subtitle">
            Peer-to-peer file transfer — encrypted, fast, no server storage
          </p>
        </div>

        {/* Divider */}
        <div className="divider" />

        {/* Actions */}
        <div className="landing-actions">
          <button className="btn btn-primary btn-glow" onClick={onCreateRoom}>
            <span className="btn-icon">✦</span>
            Create Room
          </button>

          <div className="or-divider">
            <span>or join an existing room</span>
          </div>

          <div className="join-group">
            <input
              type="text"
              className="input-field"
              placeholder="Paste room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && joinCode.trim()) onJoinRoom(joinCode);
              }}
            />
            <button
              className="btn btn-secondary"
              onClick={() => joinCode.trim() && onJoinRoom(joinCode)}
              disabled={!joinCode.trim()}
            >
              Join
            </button>
          </div>
        </div>

        {/* Features row */}
        <div className="features-row">
          <div className="feature-chip">
            <span className="feature-icon">🔒</span>
            <span>End-to-end encrypted</span>
          </div>
          <div className="feature-chip">
            <span className="feature-icon">⚡</span>
            <span>P2P — No cloud</span>
          </div>
          <div className="feature-chip">
            <span className="feature-icon">📁</span>
            <span>Up to 50 MB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
