import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MarkdownRenderer from './components/MarkdownRenderer';

interface AudioAIInterfaceProps {}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

function AudioAIInterface(): React.ReactElement {
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState<string>('');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPipelineConnected, setIsPipelineConnected] = useState(false);
  const [isResponseStreaming, setIsResponseStreaming] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [lastAudioTimestamp, setLastAudioTimestamp] = useState(0);
  const [frequencyData, setFrequencyData] = useState<number[]>([]);
  const [hasRecordedAudio, setHasRecordedAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPrivacyMode, setIsPrivacyMode] = useState(true); // Privacy ON by default
  const responseRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const handleTextUpdate = useCallback((text: string) => {
    // Received text update
    setIsResponseStreaming(true);
    
    if (text === '\n') {
      setCurrentStreamingMessage((prev) => prev + '\n\n');
    } else {
      setCurrentStreamingMessage((prev) => prev + text);
    }
  }, []);

  const handleAudioChunk = useCallback((audioData: ArrayBuffer) => {
    // TODO: Implement audio playback
    // Received audio chunk
  }, []);

  const animateWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    const barCount = 128; // More bars for smoother visualization
    const barWidth = Math.max(2, (width / barCount) * 0.8); // 80% width with gaps
    const barSpacing = width / barCount;

    // Create gradient background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);

    // Save previous frame for motion blur effect
    const imageData = ctx.getImageData(0, 0, width, height);
    ctx.putImageData(imageData, 0, 0);
    ctx.fillStyle = 'rgba(17, 24, 39, 0.5)'; // Fade effect
    ctx.fillRect(0, 0, width, height);

    // Use real frequency data if available
    for (let i = 0; i < barCount; i++) {
      let barHeight;
      const time = Date.now() / 1000; // For animations

      if (isRecording && frequencyData.length > 0) {
        // Map frequency data to bar height with smoothing
        const dataIndex = Math.floor((i / barCount) * frequencyData.length);
        const amplitude = frequencyData[dataIndex] || 0;
        
        // Apply logarithmic scaling for better visual response
        const logAmplitude = Math.log10(1 + amplitude * 9) / Math.log10(10);
        
        // Add wave animation
        const waveOffset = Math.sin(time * 2 + i * 0.1) * 0.1;
        barHeight = Math.max(2, (logAmplitude + waveOffset) * height * 0.8);
      } else if (isRecording && audioLevel > 0) {
        // Animated idle wave when recording but no data
        const wave = Math.sin(time * 3 + i * 0.2) * 0.3 + 0.5;
        barHeight = audioLevel * height * 0.5 * wave;
      } else {
        // Subtle idle animation when not recording
        const idleWave = Math.sin(time + i * 0.1) * 0.1 + 0.1;
        barHeight = height * idleWave * 0.1;
      }

      const x = i * barSpacing + (barSpacing - barWidth) / 2;
      const halfHeight = barHeight / 2;

      // Mirror effect - draw from center
      if (isRecording) {
        // Create gradient for each bar
        const gradient = ctx.createLinearGradient(x, centerY - halfHeight, x, centerY + halfHeight);
        
        const intensity = Math.min(1, barHeight / (height * 0.5));
        
        if (intensity > 0.7) {
          // High intensity - red to orange gradient
          gradient.addColorStop(0, 'rgba(239, 68, 68, 0.9)');
          gradient.addColorStop(0.5, 'rgba(251, 146, 60, 1)');
          gradient.addColorStop(1, 'rgba(239, 68, 68, 0.9)');
        } else if (intensity > 0.4) {
          // Medium intensity - purple to pink gradient
          gradient.addColorStop(0, 'rgba(167, 139, 250, 0.9)');
          gradient.addColorStop(0.5, 'rgba(236, 72, 153, 1)');
          gradient.addColorStop(1, 'rgba(167, 139, 250, 0.9)');
        } else {
          // Low intensity - blue to cyan gradient
          gradient.addColorStop(0, 'rgba(59, 130, 246, 0.7)');
          gradient.addColorStop(0.5, 'rgba(34, 211, 238, 0.9)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.7)');
        }
        
        ctx.fillStyle = gradient;
        
        // Add glow effect for high intensity
        if (intensity > 0.5) {
          ctx.shadowColor = intensity > 0.7 ? 'rgba(251, 146, 60, 0.8)' : 'rgba(236, 72, 153, 0.6)';
          ctx.shadowBlur = 10 * intensity;
        }
      } else {
        // Not recording - subtle gray gradient
        const gradient = ctx.createLinearGradient(x, centerY - halfHeight, x, centerY + halfHeight);
        gradient.addColorStop(0, 'rgba(107, 114, 128, 0.3)');
        gradient.addColorStop(0.5, 'rgba(156, 163, 175, 0.4)');
        gradient.addColorStop(1, 'rgba(107, 114, 128, 0.3)');
        ctx.fillStyle = gradient;
        ctx.shadowBlur = 0;
      }

      // Draw mirrored bars with rounded corners
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, centerY - halfHeight, barWidth, halfHeight * 2, barWidth / 2);
      } else {
        // Fallback for browsers without roundRect support
        const radius = barWidth / 2;
        ctx.moveTo(x + radius, centerY - halfHeight);
        ctx.lineTo(x + barWidth - radius, centerY - halfHeight);
        ctx.arc(x + barWidth - radius, centerY - halfHeight + radius, radius, -Math.PI / 2, 0);
        ctx.lineTo(x + barWidth, centerY + halfHeight - radius);
        ctx.arc(x + barWidth - radius, centerY + halfHeight - radius, radius, 0, Math.PI / 2);
        ctx.lineTo(x + radius, centerY + halfHeight);
        ctx.arc(x + radius, centerY + halfHeight - radius, radius, Math.PI / 2, Math.PI);
        ctx.lineTo(x, centerY - halfHeight + radius);
        ctx.arc(x + radius, centerY - halfHeight + radius, radius, Math.PI, -Math.PI / 2);
      }
      ctx.fill();
      
      // Reset shadow
      ctx.shadowBlur = 0;
    }

    // Add center line
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    animationRef.current = requestAnimationFrame(animateWaveform);
  }, [isRecording, audioLevel, frequencyData]);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    const scrollToBottom = () => {
      if (responseRef.current) {
        responseRef.current.scrollTo({
          top: responseRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    };
    
    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    requestAnimationFrame(scrollToBottom);
  }, [messages, currentStreamingMessage]);

  useEffect(() => {
    // Get initial privacy status
    window.electron.ipcRenderer.invoke('get-privacy-status').then(status => {
      setIsPrivacyMode(status);
    });

    // Set up IPC listeners for electron communication
    const removeTextListener = window.electron.ipcRenderer.on(
      'ai-text-update',
      (...args: unknown[]) => {
        const text = args[0] as string;
        handleTextUpdate(text);
      },
    );

    const removeAudioListener = window.electron.ipcRenderer.on(
      'ai-audio-chunk',
      (...args: unknown[]) => {
        const audioData = args[0] as ArrayBuffer;
        handleAudioChunk(audioData);
      },
    );

    const removeTextCompleteListener = window.electron.ipcRenderer.on(
      'ai-text-complete',
      (...args: unknown[]) => {
        const fullTranscript = args[0] as string;
        // AI complete transcript received
        
        // Create a new message with the complete response
        const finalContent = currentStreamingMessage || fullTranscript;
        if (finalContent.trim()) {
          const newMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'assistant',
            content: finalContent,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, newMessage]);
          setCurrentStreamingMessage('');
          setIsResponseStreaming(false);
        }
      },
    );

    const removeStatusListener = window.electron.ipcRenderer.on(
      'audio-status',
      (...args: unknown[]) => {
        const status = args[0] as { recording: boolean };
        setIsRecording(status.recording);

        // Clear frequency data when stopping
        if (!status.recording) {
          setFrequencyData([]);
        }
      },
    );

    const removeResponseListener = window.electron.ipcRenderer.on(
      'response-cleared',
      () => {
        setCurrentStreamingMessage('');
      },
    );

    const removeAudioDataListener = window.electron.ipcRenderer.on(
      'audio-data',
      (...args: unknown[]) => {
        const audioData = args[0] as {
          volume: number;
          timestamp: number;
          format: any;
          frequencyData?: number[];
          rawData?: Buffer;
        };
        setAudioLevel(audioData.volume);
        setLastAudioTimestamp(audioData.timestamp);

        if (audioData.frequencyData) {
          setFrequencyData(audioData.frequencyData);
        }

        // Mark that we have recorded audio when we start receiving data
        if (audioData.rawData && isRecording) {
          setHasRecordedAudio(true);
        }
      },
    );

    // AI Pipeline Event Listeners
    const removePartialTranscriptListener = window.electron.ipcRenderer.on(
      'transcript-partial',
      (...args: unknown[]) => {
        const text = args[0] as string;
        setPartialTranscript(text);
        setPipelineError(null); // Clear errors on successful transcription
      },
    );

    const removeFinalTranscriptListener = window.electron.ipcRenderer.on(
      'transcript-final',
      (...args: unknown[]) => {
        const text = args[0] as string;
        setCurrentTranscript(text);
        setPartialTranscript(''); // Clear partial when final arrives
        setPipelineError(null);
      },
    );

    const removeChatChunkListener = window.electron.ipcRenderer.on(
      'chat-chunk',
      (...args: unknown[]) => {
        const chunk = args[0] as string;
        // Received chat chunk
        setIsResponseStreaming(true);
        setCurrentStreamingMessage(prev => prev + chunk);
        setPipelineError(null);
      },
    );

    const removeChatResponseListener = window.electron.ipcRenderer.on(
      'chat-response',
      (...args: unknown[]) => {
        const response = args[0] as { content: string };
        setIsResponseStreaming(false);
        
        // Finalize the streaming message
        const finalContent = currentStreamingMessage || response.content;
        if (finalContent.trim()) {
          const newMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'assistant',
            content: finalContent,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, newMessage]);
          setCurrentStreamingMessage('');
        }
        setPipelineError(null);
      },
    );

    const removePipelineErrorListener = window.electron.ipcRenderer.on(
      'pipeline-error',
      (...args: unknown[]) => {
        const error = args[0] as string;
        setPipelineError(error);
        setIsResponseStreaming(false);
      },
    );

    const removeSttConnectedListener = window.electron.ipcRenderer.on(
      'stt.connected',
      () => {
        setIsPipelineConnected(true);
        setPipelineError(null);
      },
    );

    const removeSttClosedListener = window.electron.ipcRenderer.on(
      'stt.closed',
      (...args: unknown[]) => {
        const reason = args[1] as string;
        setIsPipelineConnected(false);
        setPipelineError(`Connection closed: ${reason}`);
      },
    );

    // Privacy mode listener
    const removePrivacyListener = window.electron.ipcRenderer.on(
      'privacy-mode-changed',
      (...args: unknown[]) => {
        const isPrivate = args[0] as boolean;
        setIsPrivacyMode(isPrivate);
      },
    );

    // Start waveform animation
    animateWaveform();

    return () => {
      removeTextListener();
      removeAudioListener();
      removeTextCompleteListener();
      removeStatusListener();
      removeResponseListener();
      removeAudioDataListener();
      removePartialTranscriptListener();
      removeFinalTranscriptListener();
      removeChatChunkListener();
      removeChatResponseListener();
      removePipelineErrorListener();
      removeSttConnectedListener();
      removeSttClosedListener();
      removePrivacyListener();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [handleTextUpdate, handleAudioChunk, animateWaveform]);

  const handleClearResponse = () => {
    setMessages([]);
    setCurrentStreamingMessage('');
    setCurrentTranscript('');
    setPartialTranscript('');
    window.electron.ipcRenderer.sendMessage('clear-response');
  };

  const toggleRecording = () => {
    if (isRecording) {
      window.electron.ipcRenderer.sendMessage('audio-stop');
      setIsRecording(false);
    } else {
      window.electron.ipcRenderer.sendMessage('audio-start');
      setIsRecording(true);
      setHasRecordedAudio(false);
    }
  };

  const togglePrivacyMode = async () => {
    try {
      const newState = await window.electron.ipcRenderer.invoke('toggle-privacy-mode');
      setIsPrivacyMode(newState);
    } catch (error) {
      console.error('Failed to toggle privacy mode:', error);
    }
  };

  const playRecordedAudio = async () => {
    if (isPlaying) return;

    try {
      const bufferedAudio =
        await window.electron.ipcRenderer.invoke('get-buffered-audio');
      if (!bufferedAudio || !bufferedAudio.buffer) {
        // No audio to replay
        return;
      }

      setIsPlaying(true);

      // Create audio context if needed
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioContext = audioContextRef.current;

      // Convert Node.js Buffer to ArrayBuffer
      const arrayBuffer = bufferedAudio.buffer.buffer.slice(
        bufferedAudio.buffer.byteOffset,
        bufferedAudio.buffer.byteOffset + bufferedAudio.buffer.byteLength,
      );

      const channels = 1; // Always mono
      let sampleCount: number;
      let audioBuffer: AudioBuffer;

      if (bufferedAudio.isFloat) {
        // Handle Float32 audio data (48kHz, high quality)
        const float32Array = new Float32Array(arrayBuffer);
        sampleCount = float32Array.length;
        
        console.log(
          `Playing Float32 audio: ${sampleCount} samples, ${channels} channels, ${bufferedAudio.sampleRate}Hz`,
        );

        // Create audio buffer at the original sample rate for best quality
        audioBuffer = audioContext.createBuffer(
          channels,
          sampleCount,
          bufferedAudio.sampleRate, // Use original 48kHz sample rate
        );

        // Directly copy Float32 data (no conversion needed)
        const channelData = audioBuffer.getChannelData(0);
        channelData.set(float32Array);
        
      } else {
        // Handle PCM16 audio data (legacy path)
        const int16Array = new Int16Array(arrayBuffer);
        sampleCount = int16Array.length;
        
        console.log(
          `Playing PCM16 audio: ${sampleCount} samples, ${channels} channels, ${bufferedAudio.sampleRate}Hz`,
        );

        audioBuffer = audioContext.createBuffer(
          channels,
          sampleCount,
          audioContext.sampleRate, // Use device sample rate to avoid resampling
        );

        // Convert int16 to float32 in range [-1, 1]
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }
      }

      // Create and play source
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Add a gain node for volume control
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.8; // Slightly reduce volume

      source.connect(gainNode);
      gainNode.connect(audioContext.destination);

      source.onended = () => {
        // Audio playback finished
        setIsPlaying(false);
      };

      // Starting audio playback
      source.start();
    } catch (error) {
      console.error('Error playing audio:', error);
      setIsPlaying(false);
    }
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20" />
      </div>
      
      {/* Privacy Mode Indicator */}
      <div className={`absolute top-6 right-6 px-3 py-1.5 rounded-full backdrop-blur-md z-50 flex items-center space-x-2 transition-all text-sm ${
        isPrivacyMode 
          ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
          : 'bg-red-500/20 text-red-400 border border-red-500/30'
      }`}>
        <div className={`w-2 h-2 rounded-full ${isPrivacyMode ? 'bg-green-400' : 'bg-red-400'} ${isPrivacyMode ? 'animate-pulse' : ''}`} />
        <span className="font-medium">
          {isPrivacyMode ? 'Private' : 'Visible'}
        </span>
      </div>
      
      <div className="w-full h-full flex flex-col p-6 relative z-10">
        {/* Header */}
        <div className="mb-4 flex-shrink-0">
          <h1 className="text-3xl font-light tracking-tight bg-gradient-to-r from-white to-purple-400 bg-clip-text text-transparent">
            AI Audio Assistant
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            {isRecording
              ? 'Listening to system audio...'
              : 'Ready to capture audio'}
          </p>
        </div>

        {/* Pipeline Status */}
        <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-4 mb-4 border border-gray-800 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Pipeline Status</h3>
            <div className="flex items-center space-x-6 text-sm">
              <div className="flex items-center space-x-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isPipelineConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-gray-300">{isPipelineConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
              {isResponseStreaming && (
                <div className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-gray-300">AI Responding</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Waveform */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-b from-gray-950 to-gray-900 border border-gray-800/50 shadow-inner">
            <div className="absolute inset-0 bg-gradient-to-r from-purple-900/10 via-transparent to-blue-900/10" />
            <canvas
              ref={canvasRef}
              width={1600}
              height={100}
              className="w-full h-24 relative z-10"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950/30 via-transparent to-gray-950/30 pointer-events-none z-20" />
            {/* Reflection effect */}
            <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent pointer-events-none z-30" />
            
            {/* Audio level indicator */}
            {isRecording && (
              <div className="absolute top-2 right-2 flex items-center space-x-2 bg-gray-900/80 backdrop-blur-sm rounded-lg px-3 py-1.5 z-40">
                <div className="flex space-x-1">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-3 rounded-full transition-all duration-150 ${
                        audioLevel > (i + 1) * 0.2
                          ? 'bg-gradient-to-t from-green-500 to-emerald-400'
                          : 'bg-gray-700'
                      }`}
                      style={{
                        height: audioLevel > (i + 1) * 0.2 ? '12px' : '4px',
                      }}
                    />
                  ))}
                </div>
                <span className="text-xs text-gray-400 font-medium">
                  {isResponseStreaming ? 'AI Processing' : 'Listening'}
                </span>
              </div>
            )}
          </div>
          
          {/* Pipeline Error */}
          {pipelineError && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg backdrop-blur-sm">
              <div className="text-red-400 font-medium text-sm">Error</div>
              <div className="text-red-300 text-xs mt-1">{pipelineError}</div>
            </div>
          )}
        </div>

        {/* Main Content Area - Side by Side */}
        <div className="flex-1 grid grid-cols-2 gap-6 overflow-hidden">
          {/* Live Transcript */}
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 flex flex-col border border-gray-800 overflow-hidden">
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Live Transcript</h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 hover-scroll">
              {/* Current partial transcript */}
              {partialTranscript && (
                <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                  <div className="text-xs text-yellow-400 mb-2 font-medium">Listening...</div>
                  <div className="text-gray-100">
                    {partialTranscript}
                    <span className="inline-block w-0.5 h-4 bg-yellow-400 animate-pulse ml-1" />
                  </div>
                </div>
              )}
              
              {/* Final transcript */}
              {currentTranscript && (
                <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20">
                  <div className="text-xs text-green-400 mb-2 font-medium">Completed</div>
                  <div className="text-gray-100">{currentTranscript}</div>
                </div>
              )}
              
              {!partialTranscript && !currentTranscript && (
                <div className="text-gray-500 italic text-center py-8">
                  {isPipelineConnected 
                    ? "Start recording to see live transcription"
                    : "Configure OpenAI API key in Settings to enable AI features"
                  }
                </div>
              )}
            </div>
          </div>

          {/* Chat Messages */}
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 flex flex-col border border-gray-800 overflow-hidden">
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Conversation</h2>
            <div
              ref={responseRef}
              className="flex-1 overflow-y-auto pr-4 space-y-4 hover-scroll"
            >
              {messages.length === 0 && !currentStreamingMessage ? (
                <div className="text-gray-500 italic text-center py-8">
                  {isPipelineConnected 
                    ? "Speak to start a conversation"
                    : "Configure OpenAI API key in Settings to enable AI features"
                  }
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[85%] ${
                          message.role === 'user'
                            ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white p-4 rounded-2xl rounded-tr-sm shadow-lg'
                            : 'bg-gray-800/50 backdrop-blur-sm text-gray-100 p-4 rounded-2xl rounded-tl-sm border border-gray-700'
                        }`}
                      >
                        <div className="text-xs mb-2 flex items-center justify-between">
                          <span className={message.role === 'user' ? 'text-blue-100' : 'text-purple-400'}>
                            {message.role === 'user' ? 'You' : 'GPT-4o'}
                          </span>
                          <span className="opacity-60">
                            {message.timestamp.toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {message.role === 'assistant' ? (
                          <MarkdownRenderer content={message.content} />
                        ) : (
                          <div className="whitespace-pre-wrap">{message.content}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Streaming message */}
                  {currentStreamingMessage && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] bg-gray-800/50 backdrop-blur-sm p-4 rounded-2xl rounded-tl-sm border border-gray-700 text-gray-100">
                        <div className="text-xs text-purple-400 mb-2 flex items-center">
                          <span>GPT-4o</span>
                          <span className="ml-3 flex items-center space-x-1">
                            <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        </div>
                        <div>
                          <MarkdownRenderer content={currentStreamingMessage} />
                          <span className="inline-block w-0.5 h-4 bg-purple-400 animate-pulse ml-1" />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="mt-4 bg-gray-900/50 backdrop-blur-sm rounded-2xl p-3 border border-gray-800 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full transition-all ${
                  isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 
                  isProcessing ? 'bg-yellow-500 animate-pulse' : 
                  'bg-gray-600'
                }`} />
                <span className="text-sm font-medium text-gray-300">
                  {isRecording ? 'Recording' : isProcessing ? 'Processing' : 'Ready'}
                </span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-400">
                <span className="font-medium">Audio Level</span>
                <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 to-yellow-500 transition-all duration-150"
                    style={{ width: `${audioLevel * 100}%` }}
                  />
                </div>
                <span className="text-xs">{Math.round(audioLevel * 100)}%</span>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-all hover:shadow-lg text-sm font-medium"
                title="Settings"
              >
                <span className="flex items-center space-x-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Settings</span>
                </span>
              </button>
              
              <button
                type="button"
                onClick={toggleRecording}
                className={`px-6 py-2 rounded-xl transition-all font-medium text-sm ${
                  isRecording
                    ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30'
                    : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg'
                }`}
              >
                {isRecording ? (
                  <span className="flex items-center space-x-2">
                    <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    <span>Stop Recording</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    <span>Start Recording</span>
                  </span>
                )}
              </button>
              
              <button
                type="button"
                onClick={handleClearResponse}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-all hover:shadow-lg text-sm font-medium"
              >
                <span className="flex items-center space-x-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Clear</span>
                </span>
              </button>
              
              <button
                type="button"
                onClick={togglePrivacyMode}
                className={`px-4 py-2 rounded-xl transition-all text-sm font-medium ${
                  isPrivacyMode
                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-600/30'
                    : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                }`}
                title={`Privacy Mode: ${isPrivacyMode ? 'Window is invisible to screen recording' : 'Window is visible in screen recording'} (Cmd/Ctrl+Shift+H)`}
              >
                <span className="flex items-center space-x-2">
                  {isPrivacyMode ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                      </svg>
                      <span>Privacy ON</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span>Visible</span>
                    </>
                  )}
                </span>
              </button>
              
              {hasRecordedAudio && !isRecording && (
                <button
                  type="button"
                  onClick={playRecordedAudio}
                  disabled={isPlaying}
                  className={`px-4 py-2 rounded-xl transition-all text-sm font-medium ${
                    isPlaying
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg'
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    <span>{isPlaying ? 'Playing...' : 'Replay'}</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioAIInterface;
