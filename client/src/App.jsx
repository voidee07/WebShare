import useWebRTC from './hooks/useWebRTC';
import LandingScreen from './components/LandingScreen';
import SenderScreen from './components/SenderScreen';
import ReceiverScreen from './components/ReceiverScreen';

export default function App() {
  const rtc = useWebRTC();

  // No room yet → show landing
  if (!rtc.roomId) {
    return (
      <LandingScreen
        onCreateRoom={rtc.createRoom}
        onJoinRoom={rtc.joinRoom}
      />
    );
  }

  // Creator → sender screen
  if (rtc.isCreator) {
    return (
      <SenderScreen
        roomId={rtc.roomId}
        status={rtc.status}
        peerConnected={rtc.peerConnected}
        file={rtc.file}
        progress={rtc.progress}
        speed={rtc.speed}
        transferComplete={rtc.transferComplete}
        error={rtc.error}
        onFileSelect={rtc.handleFileSelect}
        onStartTransfer={rtc.startTransfer}
        onReset={rtc.resetRoom}
      />
    );
  }

  // Joiner → receiver screen
  return (
    <ReceiverScreen
      roomId={rtc.roomId}
      status={rtc.status}
      peerConnected={rtc.peerConnected}
      fileName={rtc.fileName}
      progress={rtc.progress}
      speed={rtc.speed}
      transferComplete={rtc.transferComplete}
      downloadUrl={rtc.downloadUrl}
      error={rtc.error}
      onReset={rtc.resetRoom}
    />
  );
}
