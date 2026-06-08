import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

// Utility: simple room id generator
const generateRoomId = () => Math.random().toString(36).substr(2, 9);

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function App() {
  const [roomId, setRoomId] = useState('');
  const [isCreator, setIsCreator] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState('');

  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const socketRef = useRef(null);
  const fileReaderRef = useRef(null);
  const sentBytesRef = useRef(0);
  const startTimeRef = useRef(null);
  const receiveBufferRef = useRef([]);
  const expectedChunksRef = useRef(0);
  const verifiedChunksRef = useRef(new Set());

  // Initialise socket.io connection
  useEffect(() => {
    const socket = io(); // connects to same origin (Vercel will proxy)
    socketRef.current = socket;
    attachSocketHandlers();
    // cleanup
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const attachSocketHandlers = () => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.on('connect', () => console.log('socket connected'));

    socket.on('peer-joined', (peerId) => {
      console.log('Peer joined:', peerId);
      if (isCreator) createOffer();
    });

    socket.on('signal', async ({ from, data }) => {
      if (!pcRef.current) return;
      if (data.sdp) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socket.emit('signal', { roomId, data: { sdp: pcRef.current.localDescription } });
        }
      } else if (data.candidate) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error('Error adding ICE candidate', e);
        }
      }
    });

    socket.on('peer-left', (peerId) => {
      setStatus('Peer disconnected');
      // Cleanup
      pcRef.current?.close();
    });
  };

  const joinRoom = (id) => {
    setRoomId(id);
    socketRef.current.emit('join', id);
    setStatus('Waiting for peer');
    initPeer(false);
  };

  const createRoom = () => {
    const id = generateRoomId();
    setRoomId(id);
    setIsCreator(true);
    socketRef.current.emit('join', id);
    setStatus('Waiting for peer');
    initPeer(true);
  };

  // Reset room and cleanup connections
const resetRoom = () => {
  // Close data channel and peer connection if open
  dataChannelRef.current?.close();
  pcRef.current?.close();
  // Inform server about leaving (optional)
  socketRef.current?.emit('leave', roomId);
  // Reset state variables
  setRoomId('');
  setIsCreator(false);
  setFile(null);
  setProgress(0);
  setStatus('Idle');
  setError('');
};

  const createOffer = async () => {
  if (!pcRef.current) return;
  const pc = pcRef.current;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('signal', { roomId, data: { sdp: pc.localDescription } });
  } catch (err) {
    console.error('Error creating offer', err);
    setError('Failed to create offer');
  }
};
const initPeer = (creator) => {
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  pcRef.current = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socketRef.current.emit('signal', { roomId, data: { candidate: event.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    setStatus(pc.connectionState);
    if (pc.connectionState === 'connected' && file && creator) {
      startFileTransfer();
    }
  };

  if (creator) {
    const dc = pc.createDataChannel('file-transfer', { ordered: true });
    dataChannelRef.current = dc;
    attachDataChannelHandlers();
  } else {
    pc.ondatachannel = (event) => {
      dataChannelRef.current = event.channel;
      attachDataChannelHandlers();
    };
  }
};
// Duplicate initPeer block removed

  const attachDataChannelHandlers = () => {
    const dc = dataChannelRef.current;
    if (!dc) return;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      console.log('Data channel open');
      if (isCreator && file) startFileTransfer();
    };
    dc.onmessage = async (e) => {
      const msg = e.data;
      // Expect JSON for control messages, otherwise binary chunk
      if (typeof msg === 'string') {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'resume') {
          // Peer requests resume from index
          const startIdx = parsed.lastChunkIndex + 1;
          sendChunksFrom(startIdx);
        }
        return;
      }
      // Binary chunk handling
      const view = new DataView(msg);
      const index = view.getUint32(0);
      const hash = new Uint8Array(msg.slice(4, 36)); // SHA-256 32bytes
      const chunk = msg.slice(36);
      // Verify hash
      const computed = await crypto.subtle.digest('SHA-256', chunk);
      const computedArr = new Uint8Array(computed);
      const match = hash.every((b, i) => b === computedArr[i]);
      if (!match) {
        setError(`Chunk ${index} corrupted`);
        dc.send(JSON.stringify({ type: 'error', message: `Chunk ${index} corrupted` }));
        return;
      }
      receiveBufferRef.current[index] = chunk;
      verifiedChunksRef.current.add(index);
      const totalReceived = receiveBufferRef.current.filter(Boolean).length;
      const percent = Math.round((totalReceived / expectedChunksRef.current) * 100);
      setProgress(percent);
      if (totalReceived === expectedChunksRef.current) {
        // Assemble file
        const blob = new Blob(receiveBufferRef.current);
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = file?.name || 'download';
        a.click();
        setStatus('Transfer complete');
      }
    };
    dc.onerror = (e) => {
      console.error('DataChannel error', e);
      setError('Data channel error');
    };
    dc.onclose = () => console.log('Data channel closed');
  };

  const startFileTransfer = () => {
    if (!file) return;
    const chunkSize = 16 * 1024; // 16KB
    const totalChunks = Math.ceil(file.size / chunkSize);
    expectedChunksRef.current = totalChunks;
    sentBytesRef.current = 0;
    startTimeRef.current = Date.now();
    // Read all chunks sequentially
    fileReaderRef.current = new FileReader();
    let offset = 0;
    fileReaderRef.current.onload = async (e) => {
      const chunk = e.target.result;
      const hashBuffer = await crypto.subtle.digest('SHA-256', chunk);
      const hashArray = new Uint8Array(hashBuffer);
      // Build packet: [4 bytes index][32 bytes hash][chunk]
      const buffer = new Uint8Array(4 + hashArray.length + chunk.byteLength);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, offset / chunkSize);
      buffer.set(hashArray, 4);
      buffer.set(new Uint8Array(chunk), 4 + hashArray.length);
      // Back‑pressure handling
      const dc = dataChannelRef.current;
      const sendChunk = () => {
        dc.send(buffer);
        sentBytesRef.current += chunk.byteLength;
        const percent = Math.round((sentBytesRef.current / file.size) * 100);
        setProgress(percent);
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setSpeed((sentBytesRef.current / 1024 / 1024 / elapsed).toFixed(2));
        // Continue reading next chunk
        offset += chunkSize;
        if (offset < file.size) {
          fileReaderRef.current.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        }
      };
      if (dc.bufferedAmount > 64 * 1024) {
        dc.onbufferedamountlow = () => {
          dc.onbufferedamountlow = null;
          sendChunk();
        };
      } else {
        sendChunk();
      }
    };
    // Kick off first read
    fileReaderRef.current.readAsArrayBuffer(file.slice(0, chunkSize));
  };

const sendChunksFrom = (startIdx) => {
  // TODO: Implement resume logic to send chunks from startIdx onward
  console.log('Resending from chunk', startIdx);
};

  const handleFileSelect = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setError('File exceeds 50 MB limit');
      return;
    }
    setFile(f);
  };

  return (
    <div className="app">
      <h1>WebRTC P2P File Share</h1>
      {error && <div className="error">{error}</div>}
      <div className="status">Status: {status}</div>
      <div className="room-section">
        {roomId ? (
  <div>
    Room ID: <span className="room-id">{roomId}</span>
    <button className="back" onClick={resetRoom}>Back</button>
  </div>
) : (
  <div className="room-actions">
    <button onClick={createRoom}>Create Room</button>
    <input type="text" placeholder="Enter room ID" onKeyDown={(e) => { if (e.key === 'Enter') joinRoom(e.target.value); }} />
  </div>
)}
      </div>
      {roomId && (
        <div className="transfer-section">
          <input type="file" onChange={handleFileSelect} disabled={!isCreator} />
          <div className="progress-bar">
            <div className="fill" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="info">
            {progress}% transferred {speed && `· ${speed} MB/s`}
          </div>
        </div>
      )}
    </div>
  );
}
