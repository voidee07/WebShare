import React, { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// Utility: simple room id generator
const generateRoomId = () => Math.random().toString(36).substr(2, 9);

const CHUNK_SIZE = 16 * 1024; // 16KB chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function App() {
  // ─── UI state ───
  const [roomId, setRoomId] = useState('');
  const [isCreator, setIsCreator] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [transferComplete, setTransferComplete] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  // ─── Refs (survive re-renders, no stale closures) ───
  const roomIdRef = useRef('');
  const isCreatorRef = useRef(false);
  const fileRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const socketRef = useRef(null);
  const fileReaderRef = useRef(null);
  const sentBytesRef = useRef(0);
  const startTimeRef = useRef(null);
  const receiveBufferRef = useRef([]);
  const expectedChunksRef = useRef(0);
  const pendingStartRef = useRef(false);

  // ─── Keep refs in sync with state ───
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { isCreatorRef.current = isCreator; }, [isCreator]);
  useEffect(() => { fileRef.current = file; }, [file]);

  // ─── Socket.io setup (runs once) ───
  useEffect(() => {
    const socket = io('http://localhost:3001');
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[SOCKET] Connected, id:', socket.id);
    });

    socket.on('peer-joined', (peerId) => {
      console.log('[SOCKET] Peer joined:', peerId);
      // Only the room creator sends the offer
      if (isCreatorRef.current) {
        console.log('[SIGNAL] I am creator, creating offer...');
        createOffer();
      }
    });

    socket.on('signal', async ({ from, data }) => {
      console.log('[SIGNAL] Received from', from, data.sdp ? `SDP (${data.sdp.type})` : 'ICE candidate');
      const pc = pcRef.current;
      if (!pc) {
        console.warn('[SIGNAL] No peer connection, ignoring signal');
        return;
      }

      try {
        if (data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          console.log('[SIGNAL] Remote description set, type:', data.sdp.type);

          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log('[SIGNAL] Sending answer...');
            socket.emit('signal', { roomId: roomIdRef.current, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('[ICE] Added remote ICE candidate');
        }
      } catch (err) {
        console.error('[SIGNAL] Error handling signal:', err);
      }
    });

    socket.on('peer-left', (peerId) => {
      console.log('[SOCKET] Peer left:', peerId);
      setStatus('Peer disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── WebRTC Peer Connection ───
  const initPeer = useCallback((creator) => {
    console.log('[PEER] Initializing peer connection, creator:', creator);
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ICE] Sending ICE candidate');
        socketRef.current.emit('signal', {
          roomId: roomIdRef.current,
          data: { candidate: event.candidate }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[ICE] Connection state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[PEER] Connection state:', pc.connectionState);
      setStatus(pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log('[PEER] Signaling state:', pc.signalingState);
    };

    if (creator) {
      // Creator makes the data channel
      const dc = pc.createDataChannel('file-transfer', { ordered: true });
      console.log('[DC] Creator created data channel, state:', dc.readyState);
      dataChannelRef.current = dc;
      setupDataChannel(dc);
    } else {
      // Receiver waits for the data channel
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        console.log('[DC] Receiver got data channel, state:', dc.readyState);
        dataChannelRef.current = dc;
        setupDataChannel(dc);
      };
    }
  }, []);

  // ─── Data Channel Handlers ───
  const setupDataChannel = useCallback((dc) => {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log('[DC] ✅ Data channel OPEN');
      setStatus('Connected — ready to transfer');

      // If the user already clicked "Start Transfer" before channel was open
      if (pendingStartRef.current && isCreatorRef.current && fileRef.current) {
        console.log('[DC] Pending start detected, beginning transfer...');
        pendingStartRef.current = false;
        doStartFileTransfer();
      }
    };

    dc.onmessage = async (e) => {
      const msg = e.data;

      // JSON control messages
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          console.log('[DC] Control message:', parsed);

          if (parsed.type === 'file-meta') {
            // Sender tells receiver the file name and total chunks
            expectedChunksRef.current = parsed.totalChunks;
            receiveBufferRef.current = new Array(parsed.totalChunks);
            setFileName(parsed.name);
            setStatus(`Receiving: ${parsed.name}`);
            console.log(`[DC] Expecting ${parsed.totalChunks} chunks for "${parsed.name}"`);
          } else if (parsed.type === 'transfer-complete') {
            console.log('[DC] Sender says transfer is complete, assembling file...');
            assembleFile(parsed.name);
          }
        } catch (err) {
          console.error('[DC] Error parsing control message:', err);
        }
        return;
      }

      // Binary chunk: [4 bytes index][32 bytes SHA-256 hash][chunk data]
      const view = new DataView(msg);
      const index = view.getUint32(0);
      const chunk = msg.slice(36); // skip index (4) + hash (32)

      receiveBufferRef.current[index] = chunk;
      const totalReceived = receiveBufferRef.current.filter(Boolean).length;
      const total = expectedChunksRef.current;
      const percent = total > 0 ? Math.round((totalReceived / total) * 100) : 0;
      setProgress(percent);

      if (totalReceived % 50 === 0 || totalReceived === total) {
        console.log(`[DC] Received chunk ${index}, total: ${totalReceived}/${total} (${percent}%)`);
      }
    };

    dc.onerror = (err) => {
      console.error('[DC] Error:', err);
      setError('Data channel error');
    };

    dc.onclose = () => {
      console.log('[DC] Data channel closed');
    };
  }, []);

  // ─── Assemble received file ───
  const assembleFile = (name) => {
    const totalReceived = receiveBufferRef.current.filter(Boolean).length;
    const expected = expectedChunksRef.current;
    console.log(`[FILE] Assembling: received ${totalReceived}/${expected} chunks`);

    if (totalReceived < expected) {
      console.warn(`[FILE] Missing ${expected - totalReceived} chunks!`);
      setError(`Missing ${expected - totalReceived} chunks`);
      return;
    }

    const blob = new Blob(receiveBufferRef.current);
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setTransferComplete(true);
    setStatus('Transfer complete!');
    setFileName(name);
    console.log('[FILE] ✅ File assembled, download ready');
  };

  // ─── Create SDP Offer (creator only) ───
  const createOffer = async () => {
    const pc = pcRef.current;
    if (!pc) {
      console.warn('[SIGNAL] Cannot create offer: no peer connection');
      return;
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[SIGNAL] Sending offer...');
      socketRef.current.emit('signal', {
        roomId: roomIdRef.current,
        data: { sdp: pc.localDescription }
      });
    } catch (err) {
      console.error('[SIGNAL] Error creating offer:', err);
      setError('Failed to create offer');
    }
  };

  // ─── Room Actions ───
  const createRoom = () => {
    const id = generateRoomId();
    setRoomId(id);
    roomIdRef.current = id; // set ref immediately (state update is async)
    setIsCreator(true);
    isCreatorRef.current = true;
    console.log(`[ROOM] Created room: ${id}`);
    socketRef.current.emit('join', id);
    setStatus('Waiting for peer to join...');
    initPeer(true);
  };

  const joinRoom = (id) => {
    if (!id.trim()) return;
    setRoomId(id);
    roomIdRef.current = id;
    setIsCreator(false);
    isCreatorRef.current = false;
    console.log(`[ROOM] Joining room: ${id}`);
    socketRef.current.emit('join', id);
    setStatus('Waiting for peer...');
    initPeer(false);
  };

  const resetRoom = () => {
    dataChannelRef.current?.close();
    pcRef.current?.close();
    socketRef.current?.emit('leave', roomIdRef.current);
    setRoomId('');
    roomIdRef.current = '';
    setIsCreator(false);
    isCreatorRef.current = false;
    setFile(null);
    fileRef.current = null;
    setProgress(0);
    setSpeed(0);
    setStatus('Idle');
    setError('');
    setDownloadUrl('');
    setTransferComplete(false);
    setFileName('');
    pendingStartRef.current = false;
    receiveBufferRef.current = [];
    expectedChunksRef.current = 0;
    console.log('[ROOM] Reset');
  };

  // ─── File Selection ───
  const handleFileSelect = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setError(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`);
      return;
    }
    setFile(f);
    fileRef.current = f;
    setError('');
    console.log(`[FILE] Selected: ${f.name} (${(f.size / 1024).toFixed(1)} KB)`);
  };

  // ─── Start Transfer (button click) ───
  const startTransfer = () => {
    console.log('[TRANSFER] Start Transfer clicked');
    const f = fileRef.current;
    if (!f) {
      setError('No file selected');
      return;
    }

    const dc = dataChannelRef.current;
    if (dc && dc.readyState === 'open') {
      console.log('[TRANSFER] Data channel is open, starting now');
      doStartFileTransfer();
    } else {
      console.log('[TRANSFER] Data channel not open yet, queuing start. DC state:', dc?.readyState);
      pendingStartRef.current = true;
      setStatus('Waiting for connection to establish...');
    }
  };

  // ─── Actual File Transfer Logic ───
  const doStartFileTransfer = () => {
    const f = fileRef.current;
    if (!f) return;

    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') {
      console.error('[TRANSFER] Data channel not open, cannot start');
      return;
    }

    const totalChunks = Math.ceil(f.size / CHUNK_SIZE);
    console.log(`[TRANSFER] Starting: ${f.name}, ${totalChunks} chunks, ${(f.size / 1024).toFixed(1)} KB`);

    // Send file metadata to receiver
    dc.send(JSON.stringify({
      type: 'file-meta',
      name: f.name,
      size: f.size,
      totalChunks
    }));

    sentBytesRef.current = 0;
    startTimeRef.current = Date.now();
    setStatus('Transferring...');

    let offset = 0;
    const reader = new FileReader();

    reader.onload = async (e) => {
      const chunk = e.target.result;
      const hashBuffer = await crypto.subtle.digest('SHA-256', chunk);
      const hashArray = new Uint8Array(hashBuffer);

      // Build packet: [4 bytes index][32 bytes hash][chunk]
      const chunkIndex = Math.floor(offset / CHUNK_SIZE);
      const buffer = new Uint8Array(4 + 32 + chunk.byteLength);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, chunkIndex);
      buffer.set(hashArray, 4);
      buffer.set(new Uint8Array(chunk), 36);

      const sendChunk = () => {
        try {
          dc.send(buffer);
        } catch (err) {
          console.error(`[TRANSFER] Error sending chunk ${chunkIndex}:`, err);
          setError(`Error sending chunk ${chunkIndex}`);
          return;
        }

        sentBytesRef.current += chunk.byteLength;
        const percent = Math.round((sentBytesRef.current / f.size) * 100);
        setProgress(percent);

        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (elapsed > 0) {
          setSpeed((sentBytesRef.current / 1024 / 1024 / elapsed).toFixed(2));
        }

        if (chunkIndex % 50 === 0 || offset + CHUNK_SIZE >= f.size) {
          console.log(`[TRANSFER] Sent chunk ${chunkIndex}/${totalChunks} (${percent}%)`);
        }

        // Next chunk
        offset += CHUNK_SIZE;
        if (offset < f.size) {
          reader.readAsArrayBuffer(f.slice(offset, offset + CHUNK_SIZE));
        } else {
          // All chunks sent
          console.log('[TRANSFER] ✅ All chunks sent!');
          dc.send(JSON.stringify({ type: 'transfer-complete', name: f.name }));
          setStatus('Transfer complete!');
          setTransferComplete(true);
        }
      };

      // Back-pressure handling
      if (dc.bufferedAmount > 64 * 1024) {
        dc.onbufferedamountlow = () => {
          dc.onbufferedamountlow = null;
          sendChunk();
        };
      } else {
        sendChunk();
      }
    };

    reader.onerror = (err) => {
      console.error('[TRANSFER] FileReader error:', err);
      setError('Error reading file');
    };

    // Kick off the first read
    reader.readAsArrayBuffer(f.slice(0, CHUNK_SIZE));
  };

  // ─── Supported file types display ───
  const supportedTypes = 'PDF, JPEG, PNG, GIF, MP4, MP3, ZIP, TXT, DOCX, XLSX, CSV';

  // ─── Render ───
  return (
    <div className="app">
      <h1>WebRTC P2P File Share</h1>

      {error && <div className="error">{error}</div>}
      <div className="status">Status: {status}</div>

      <div className="room-section">
        {roomId ? (
          <div className="room-info">
            <span>Room ID: <strong className="room-id">{roomId}</strong></span>
            <button className="reset-btn" onClick={resetRoom}>Reset</button>
          </div>
        ) : (
          <div className="room-actions">
            <button onClick={createRoom}>Create Room</button>
            <div className="join-section">
              <input
                type="text"
                placeholder="Enter room ID"
                onKeyDown={(e) => { if (e.key === 'Enter') joinRoom(e.target.value); }}
              />
              <button onClick={(e) => {
                const input = e.target.previousElementSibling;
                if (input) joinRoom(input.value);
              }}>Join</button>
            </div>
          </div>
        )}
      </div>

      {roomId && (
        <div className="transfer-section">
          {isCreator ? (
            <div className="sender-panel">
              <p className="supported-types">Supported: {supportedTypes}</p>
              <input type="file" onChange={handleFileSelect} />
              {file && (
                <div className="file-info">
                  <p>📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
                  {!transferComplete && (
                    <button className="start-btn" onClick={startTransfer}>
                      🚀 Start Transfer
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="receiver-panel">
              {!transferComplete ? (
                <p className="waiting-msg">
                  {fileName ? `Receiving: ${fileName}` : 'Waiting for peer to send a file...'}
                </p>
              ) : (
                <p className="complete-msg">✅ Transfer complete!</p>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="progress-bar">
            <div className="fill" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="info">
            {progress}% transferred {speed > 0 && `· ${speed} MB/s`}
          </div>

          {/* Download button for receiver */}
          {transferComplete && downloadUrl && (
            <a href={downloadUrl} download={fileName || 'download'} className="download-btn">
              ⬇️ Download File
            </a>
          )}
        </div>
      )}
    </div>
  );
}
