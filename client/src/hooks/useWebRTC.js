import { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';

const CHUNK_SIZE = 16 * 1024; // 16KB chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const generateRoomId = () => Math.random().toString(36).substr(2, 9);

// Determine the signaling server URL based on environment
const getServerUrl = () => {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (import.meta.env.PROD) return window.location.origin;
  return 'http://localhost:3001';
};

export default function useWebRTC() {
  // ─── UI state ───
  const [roomId, setRoomId] = useState('');
  const [isCreator, setIsCreator] = useState(false);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [transferComplete, setTransferComplete] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [peerConnected, setPeerConnected] = useState(false);

  // ─── Refs ───
  const roomIdRef = useRef('');
  const isCreatorRef = useRef(false);
  const fileRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const socketRef = useRef(null);
  const sentBytesRef = useRef(0);
  const startTimeRef = useRef(null);
  const receiveBufferRef = useRef([]);
  const expectedChunksRef = useRef(0);
  const pendingStartRef = useRef(false);
  const receivedBytesRef = useRef(0);

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { isCreatorRef.current = isCreator; }, [isCreator]);
  useEffect(() => { fileRef.current = file; }, [file]);

  // ─── Socket.io ───
  useEffect(() => {
    const socket = io(getServerUrl());
    socketRef.current = socket;

    socket.on('connect', () => console.log('[SOCKET] Connected:', socket.id));

    socket.on('peer-joined', (peerId) => {
      console.log('[SOCKET] Peer joined:', peerId);
      setPeerConnected(true);
      if (isCreatorRef.current) {
        console.log('[SIGNAL] Creating offer...');
        createOffer();
      }
    });

    socket.on('signal', async ({ from, data }) => {
      console.log('[SIGNAL] Received', data.sdp ? `SDP(${data.sdp.type})` : 'ICE');
      const pc = pcRef.current;
      if (!pc) return;

      try {
        if (data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          if (data.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { roomId: roomIdRef.current, data: { sdp: pc.localDescription } });
          }
        } else if (data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error('[SIGNAL] Error:', err);
      }
    });

    socket.on('peer-left', () => {
      setStatus('peer-disconnected');
      setPeerConnected(false);
    });

    // Check for room invite link on mount
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomId(room.trim());
      roomIdRef.current = room.trim();
      setIsCreator(false);
      isCreatorRef.current = false;
      socket.emit('join', room.trim());
      setStatus('waiting');
      initPeer(false);
      
      // Clean up URL parameters
      const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    return () => socket.disconnect();
  }, [initPeer]);

  // ─── Data Channel setup ───
  const setupDataChannel = useCallback((dc) => {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log('[DC] ✅ OPEN');
      setStatus('connected');
      setPeerConnected(true);
      if (pendingStartRef.current && isCreatorRef.current && fileRef.current) {
        pendingStartRef.current = false;
        doStartFileTransfer();
      }
    };

    dc.onmessage = async (e) => {
      const msg = e.data;
      if (typeof msg === 'string') {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'file-meta') {
            expectedChunksRef.current = parsed.totalChunks;
            receiveBufferRef.current = new Array(parsed.totalChunks);
            setFileName(parsed.name);
            setStatus('receiving');
            receivedBytesRef.current = 0;
            startTimeRef.current = Date.now();
            setProgress(0);
            setSpeed(0);
          } else if (parsed.type === 'transfer-complete') {
            assembleFile(parsed.name);
          }
        } catch (err) {
          console.error('[DC] Parse error:', err);
        }
        return;
      }

      const view = new DataView(msg);
      const index = view.getUint32(0);
      const sentHash = new Uint8Array(msg, 4, 32);
      const chunk = msg.slice(36);

      // Verify SHA-256 cryptographic hash of received chunk
      try {
        const computedHashBuffer = await crypto.subtle.digest('SHA-256', chunk);
        const computedHash = new Uint8Array(computedHashBuffer);
        let hashMatch = true;
        for (let i = 0; i < 32; i++) {
          if (sentHash[i] !== computedHash[i]) {
            hashMatch = false;
            break;
          }
        }
        if (!hashMatch) {
          console.error(`[DC] ❌ Hash verification failed for chunk ${index}`);
          setError(`Data corruption detected at chunk ${index}`);
          return;
        }
      } catch (err) {
        console.error('[DC] Hash computation error:', err);
        setError('Verification failed during transfer');
        return;
      }

      receiveBufferRef.current[index] = chunk;
      receivedBytesRef.current += chunk.byteLength;

      const totalReceived = receiveBufferRef.current.filter(Boolean).length;
      const total = expectedChunksRef.current;
      setProgress(total > 0 ? Math.round((totalReceived / total) * 100) : 0);

      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (elapsed > 0) {
        setSpeed((receivedBytesRef.current / 1024 / 1024 / elapsed).toFixed(2));
      }
    };

    dc.onerror = (err) => {
      console.error('[DC] Error:', err);
      setError('Data channel error');
    };
    dc.onclose = () => console.log('[DC] Closed');
  }, []);

  // ─── Peer Connection ───
  const initPeer = useCallback((creator) => {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('signal', {
          roomId: roomIdRef.current,
          data: { candidate: event.candidate }
        });
      }
    };

    pc.oniceconnectionstatechange = () => console.log('[ICE]', pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') setStatus('connected');
      else if (state === 'failed' || state === 'disconnected') {
        setStatus('peer-disconnected');
        setPeerConnected(false);
      }
    };

    if (creator) {
      const dc = pc.createDataChannel('file-transfer', { ordered: true });
      dataChannelRef.current = dc;
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
        setupDataChannel(event.channel);
      };
    }
  }, []);

  const createOffer = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit('signal', {
        roomId: roomIdRef.current,
        data: { sdp: pc.localDescription }
      });
    } catch (err) {
      console.error('[SIGNAL] Offer error:', err);
      setError('Failed to create offer');
    }
  };

  const assembleFile = (name) => {
    const totalReceived = receiveBufferRef.current.filter(Boolean).length;
    const expected = expectedChunksRef.current;
    if (totalReceived < expected) {
      setError(`Missing ${expected - totalReceived} chunks`);
      return;
    }
    const blob = new Blob(receiveBufferRef.current);
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setTransferComplete(true);
    setStatus('complete');
    setFileName(name);
    console.log('[FILE] ✅ Assembled');

    // Automatically trigger local file download when completed
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      console.log('[FILE] ✅ Auto-download triggered');
    } catch (err) {
      console.error('[FILE] Auto-download failed:', err);
    }
  };

  // ─── Room Actions ───
  const createRoom = () => {
    const id = generateRoomId();
    setRoomId(id);
    roomIdRef.current = id;
    setIsCreator(true);
    isCreatorRef.current = true;
    socketRef.current.emit('join', id);
    setStatus('waiting');
    initPeer(true);
  };

  const joinRoom = (id) => {
    if (!id.trim()) return;
    setRoomId(id.trim());
    roomIdRef.current = id.trim();
    setIsCreator(false);
    isCreatorRef.current = false;
    socketRef.current.emit('join', id.trim());
    setStatus('waiting');
    initPeer(false);
  };

  const resetRoom = () => {
    dataChannelRef.current?.close();
    pcRef.current?.close();
    socketRef.current?.emit('leave', roomIdRef.current);
    setRoomId(''); roomIdRef.current = '';
    setIsCreator(false); isCreatorRef.current = false;
    setFile(null); fileRef.current = null;
    setProgress(0); setSpeed(0);
    setStatus('idle'); setError('');
    setDownloadUrl(''); setTransferComplete(false);
    setFileName(''); setPeerConnected(false);
    pendingStartRef.current = false;
    receiveBufferRef.current = [];
    expectedChunksRef.current = 0;
    receivedBytesRef.current = 0;
  };

  // ─── File ───
  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`);
      return;
    }
    setFile(selectedFile);
    fileRef.current = selectedFile;
    setError('');
  };

  // ─── Transfer ───
  const startTransfer = () => {
    const f = fileRef.current;
    if (!f) { setError('No file selected'); return; }

    const dc = dataChannelRef.current;
    if (dc && dc.readyState === 'open') {
      doStartFileTransfer();
    } else {
      pendingStartRef.current = true;
      setStatus('connecting');
    }
  };

  const doStartFileTransfer = () => {
    const f = fileRef.current;
    const dc = dataChannelRef.current;
    if (!f || !dc || dc.readyState !== 'open') return;

    const totalChunks = Math.ceil(f.size / CHUNK_SIZE);
    dc.send(JSON.stringify({ type: 'file-meta', name: f.name, size: f.size, totalChunks }));

    sentBytesRef.current = 0;
    startTimeRef.current = Date.now();
    setStatus('transferring');

    let offset = 0;
    const reader = new FileReader();

    reader.onload = async (e) => {
      const chunk = e.target.result;
      const hashBuffer = await crypto.subtle.digest('SHA-256', chunk);
      const hashArray = new Uint8Array(hashBuffer);
      const chunkIndex = Math.floor(offset / CHUNK_SIZE);
      const buffer = new Uint8Array(4 + 32 + chunk.byteLength);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, chunkIndex);
      buffer.set(hashArray, 4);
      buffer.set(new Uint8Array(chunk), 36);

      const sendChunk = () => {
        try { dc.send(buffer); } catch (err) {
          setError(`Error sending chunk ${chunkIndex}`);
          return;
        }
        sentBytesRef.current += chunk.byteLength;
        setProgress(Math.round((sentBytesRef.current / f.size) * 100));
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (elapsed > 0) setSpeed((sentBytesRef.current / 1024 / 1024 / elapsed).toFixed(2));

        offset += CHUNK_SIZE;
        if (offset < f.size) {
          reader.readAsArrayBuffer(f.slice(offset, offset + CHUNK_SIZE));
        } else {
          dc.send(JSON.stringify({ type: 'transfer-complete', name: f.name }));
          setStatus('complete');
          setTransferComplete(true);
        }
      };

      if (dc.bufferedAmount > 64 * 1024) {
        dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; sendChunk(); };
      } else {
        sendChunk();
      }
    };

    reader.onerror = () => setError('Error reading file');
    reader.readAsArrayBuffer(f.slice(0, CHUNK_SIZE));
  };

  return {
    roomId, isCreator, file, status, progress, speed,
    downloadUrl, transferComplete, error, fileName, peerConnected,
    createRoom, joinRoom, resetRoom, handleFileSelect, startTransfer,
  };
}
