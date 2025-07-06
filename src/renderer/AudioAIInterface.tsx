import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MarkdownRenderer from './components/MarkdownRenderer';
import LoadingScreen from './components/LoadingScreen';
import { useTheme } from './contexts/ThemeContext';

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
  const { theme, toggleTheme, isDark } = useTheme();
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStreamingMessage, setCurrentStreamingMessage] =
    useState<string>('');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPipelineConnected, setIsPipelineConnected] = useState(false);
  const [isResponseStreaming, setIsResponseStreaming] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [lastAudioTimestamp, setLastAudioTimestamp] = useState(0);
  const [frequencyData, setFrequencyData] = useState<number[]>([]);
  const [isPrivacyMode, setIsPrivacyMode] = useState(true);
  const [currentAIProvider, setCurrentAIProvider] = useState<
    'openai' | 'gemini'
  >('openai');
  const [transcriptEnabled, setTranscriptEnabled] = useState(true);
  const [initializationProgress, setInitializationProgress] = useState<{
    step: string;
    status: string;
    message: string;
  } | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(null);

  const handleTextUpdate = useCallback((text: string) => {
    setIsResponseStreaming(true);

    if (text === '\n') {
      setCurrentStreamingMessage((prev) => prev + '\n\n');
    } else {
      setCurrentStreamingMessage((prev) => prev + text);
    }
  }, []);

  const animateWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;
    const barCount = 64;
    const barWidth = 2;
    const barSpacing = width / barCount;

    // Clear canvas
    ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0, 0, width, height);

    const baseColor = isDark ? 'rgba(255, 255, 255' : 'rgba(0, 0, 0';

    for (let i = 0; i < barCount; i++) {
      let barHeight;
      const time = Date.now() / 1000;

      if (isRecording && frequencyData.length > 0) {
        const dataIndex = Math.floor((i / barCount) * frequencyData.length);
        const amplitude = frequencyData[dataIndex] || 0;
        const logAmplitude = Math.log10(1 + amplitude * 9) / Math.log10(10);
        const waveOffset = Math.sin(time * 2 + i * 0.1) * 0.05;
        barHeight = Math.max(1, (logAmplitude + waveOffset) * height * 0.7);
      } else if (isRecording && audioLevel > 0) {
        const wave = Math.sin(time * 3 + i * 0.2) * 0.3 + 0.5;
        barHeight = audioLevel * height * 0.4 * wave;
      } else {
        const idleWave = Math.sin(time + i * 0.1) * 0.1 + 0.1;
        barHeight = height * idleWave * 0.05;
      }

      const x = i * barSpacing + (barSpacing - barWidth) / 2;

      // Draw bars with opacity based on height
      const opacity = isRecording ? 0.3 + (barHeight / height) * 0.7 : 0.2;
      ctx.fillStyle = `${baseColor}, ${opacity})`;

      // Draw top bar
      ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight / 2);
      // Draw bottom bar (mirror)
      ctx.fillRect(x, centerY, barWidth, barHeight / 2);
    }

    animationRef.current = requestAnimationFrame(animateWaveform);
  }, [isRecording, audioLevel, frequencyData, isDark]);

  // Load current AI provider and transcript settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await window.electronAPI.getSettings();
        if (settings?.aiProvider) {
          setCurrentAIProvider(settings.aiProvider);
        }
        if (settings?.transcriptSettings) {
          setTranscriptEnabled(settings.transcriptSettings.enabled ?? true);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    // Trigger re-initialization if not already initialized
    const triggerReInitialization = async () => {
      if (!isInitialized && !initializationProgress) {
        console.log('🔄 [UI] Triggering app re-initialization...');
        try {
          await window.electronAPI.reInitializeApp();
        } catch (error) {
          console.error('❌ [UI] Failed to trigger re-initialization:', error);
        }
      }
    };
    
    triggerReInitialization();
    
    // Listen for initialization progress
    const cleanupInitProgress = window.electronAPI.onInitializationProgress((progress) => {
      setInitializationProgress(progress);
      
      // Mark as initialized when complete
      if (progress.step === 'complete') {
        setTimeout(() => {
          setIsInitialized(true);
        }, 500); // Small delay to show completion
      }
    });

    // Store cleanup functions from each event handler
    const cleanupTranscript = window.electronAPI.onTranscript(
      (transcript: string, isPartial: boolean) => {
        if (isPartial) {
          setPartialTranscript(transcript);
        } else {
          setCurrentTranscript(transcript);
          setPartialTranscript('');
        }
      },
    );

    const cleanupAudioLevel = window.electronAPI.onAudioLevel((level: number) => {
      setAudioLevel(level);
    });

    const cleanupRealtimeUpdate = window.electronAPI.onRealtimeUpdate(({ type, data }) => {
      switch (type) {
        case 'responseCreated':
          setCurrentStreamingMessage('');
          setIsResponseStreaming(true);
          break;
        case 'responseDone':
          setIsResponseStreaming(false);
          setCurrentStreamingMessage((currentMessage) => {
            if (currentMessage.trim()) {
              const newMessage: ChatMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: currentMessage,
                timestamp: new Date(),
                isStreaming: false,
              };
              setMessages((prev) => [...prev, newMessage]);
            }
            return '';
          });
          break;
        case 'responseTextDelta':
          handleTextUpdate(data);
          break;
        case 'conversationInterrupted':
          setIsResponseStreaming(false);
          setCurrentStreamingMessage('');
          break;
        case 'error':
          console.error('Realtime error:', data);
          setPipelineError(data);
          break;
      }
    });

    const cleanupFrequencyData = window.electronAPI.onFrequencyData((data: number[]) => {
      setFrequencyData(data);
    });

    const cleanupPipelineStatus = window.electronAPI.onPipelineStatus((connected: boolean) => {
      setIsPipelineConnected(connected);
      if (!connected) {
        setPipelineError('Audio pipeline disconnected');
      } else {
        setPipelineError(null);
      }
    });

    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    }

    animationRef.current = requestAnimationFrame(animateWaveform);

    // Proper cleanup function that calls ALL cleanup functions
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      
      // Clean up all event listeners
      cleanupInitProgress();
      cleanupTranscript();
      cleanupAudioLevel();
      cleanupRealtimeUpdate();
      cleanupFrequencyData();
      cleanupPipelineStatus();
    };
  }, [handleTextUpdate, animateWaveform]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      await window.electronAPI.stopRecording();
      setIsRecording(false);
    } else {
      await window.electronAPI.startRecording();
      setIsRecording(true);
    }
  }, [isRecording]);

  const sendMessage = useCallback(async () => {
    if (!currentTranscript.trim() && !partialTranscript.trim()) return;

    const messageContent = currentTranscript || partialTranscript;
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setCurrentTranscript('');
    setPartialTranscript('');
    setIsProcessing(true);

    try {
      await window.electronAPI.sendMessage(messageContent);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [currentTranscript, partialTranscript]);

  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [messages, currentStreamingMessage]);

  // Additional effect to continuously scroll during streaming
  useEffect(() => {
    if (isResponseStreaming && responseRef.current) {
      const scrollToBottom = () => {
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      };
      
      // Scroll immediately and then every 100ms during streaming
      scrollToBottom();
      const interval = setInterval(scrollToBottom, 100);
      
      return () => clearInterval(interval);
    }
  }, [isResponseStreaming]);

  const togglePrivacyMode = useCallback(() => {
    const newPrivacyMode = !isPrivacyMode;
    setIsPrivacyMode(newPrivacyMode);
    window.electronAPI.setPrivacyMode(newPrivacyMode);
  }, [isPrivacyMode]);

  // Privacy mode shortcut handler
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'h') {
        e.preventDefault();
        togglePrivacyMode();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [togglePrivacyMode]);

  // Show loading screen until initialization is complete
  if (!isInitialized) {
    return <LoadingScreen progress={initializationProgress} />;
  }

  return (
    <div
      className={`w-full h-screen ${isDark ? 'bg-audiomind-black' : 'bg-audiomind-white'} ${isDark ? 'text-audiomind-white' : 'text-audiomind-black'} overflow-hidden`}
    >
      {/* Header */}
      <div
        className={`h-14 border-b ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'} flex items-center justify-between px-6`}
      >
        <div className="flex items-center space-x-4">
          <h1 className="text-lg font-medium tracking-tight">AudioMind</h1>
          <div
            className={`flex items-center space-x-4 text-xs ${isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'}`}
          >
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${isPipelineConnected ? 'bg-audiomind-gray-500' : 'bg-audiomind-gray-700'}`}
              />
              <span>{isPipelineConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div
              className={`px-2 py-1 rounded text-xs font-medium ${
                isDark
                  ? 'bg-audiomind-gray-900 text-audiomind-gray-300'
                  : 'bg-audiomind-gray-100 text-audiomind-gray-700'
              }`}
            >
              {currentAIProvider === 'openai'
                ? 'OpenAI GPT-4o'
                : 'Google Gemini'}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className={`p-2 rounded transition-colors ${
              isDark
                ? 'hover:bg-audiomind-gray-900 text-audiomind-gray-400 hover:text-audiomind-white'
                : 'hover:bg-audiomind-gray-100 text-audiomind-gray-600 hover:text-audiomind-black'
            }`}
            title="Toggle theme"
          >
            {isDark ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>

          {/* Privacy Mode */}
          <button
            onClick={togglePrivacyMode}
            className={`p-2 rounded transition-colors ${
              isPrivacyMode
                ? isDark
                  ? 'bg-audiomind-gray-900 text-audiomind-white'
                  : 'bg-audiomind-gray-900 text-audiomind-white'
                : isDark
                  ? 'hover:bg-audiomind-gray-900 text-audiomind-gray-400'
                  : 'hover:bg-audiomind-gray-100 text-audiomind-gray-600'
            }`}
            title="Privacy mode (Cmd/Ctrl+Shift+H)"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isPrivacyMode ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              )}
            </svg>
          </button>

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            className={`p-2 rounded transition-colors ${
              isDark
                ? 'hover:bg-audiomind-gray-900 text-audiomind-gray-400 hover:text-audiomind-white'
                : 'hover:bg-audiomind-gray-100 text-audiomind-gray-600 hover:text-audiomind-black'
            }`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div
        className={`h-[calc(100vh-3.5rem)] flex ${transcriptEnabled ? 'divide-x' : ''} ${isDark ? 'divide-audiomind-gray-900' : 'divide-audiomind-gray-200'}`}
      >
        {/* Transcript Panel - Only show if enabled */}
        {transcriptEnabled && (
          <div className="flex flex-col w-1/2 h-full">
            <div
              className={`p-4 border-b ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'} flex-shrink-0`}
            >
              <h2
                className={`text-sm font-medium ${isDark ? 'text-audiomind-gray-300' : 'text-audiomind-gray-700'}`}
              >
                Live Transcript
              </h2>
            </div>
            <div className="flex-1 overflow-y-scroll p-4">
              {currentTranscript || partialTranscript ? (
                <div className="space-y-2">
                  {currentTranscript && (
                    <p
                      className={`text-sm leading-relaxed ${isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'}`}
                    >
                      {currentTranscript}
                    </p>
                  )}
                  {partialTranscript && (
                    <p
                      className={`text-sm leading-relaxed ${isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-500'} italic`}
                    >
                      {partialTranscript}
                    </p>
                  )}
                </div>
              ) : (
                <p
                  className={`${isDark ? 'text-audiomind-gray-600' : 'text-audiomind-gray-400'} text-sm`}
                >
                  {isRecording ? 'Listening...' : 'Click record to start'}
                </p>
              )}
            </div>

            {/* Audio Waveform */}
            <div
              className={`border-t ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'} p-4 flex-shrink-0`}
            >
              <canvas
                ref={canvasRef}
                className="w-full h-20"
                style={{ width: '100%', height: '80px' }}
              />
            </div>

            {/* Controls */}
            <div
              className={`border-t ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'} p-4 flex-shrink-0`}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={toggleRecording}
                  className={`px-6 py-2 rounded-full font-medium transition-all ${
                    isRecording
                      ? isDark
                        ? 'bg-audiomind-white text-audiomind-black hover:bg-audiomind-gray-100'
                        : 'bg-audiomind-black text-audiomind-white hover:bg-audiomind-gray-900'
                      : isDark
                        ? 'bg-audiomind-gray-900 text-audiomind-gray-300 hover:bg-audiomind-gray-800 hover:text-audiomind-white'
                        : 'bg-audiomind-gray-100 text-audiomind-gray-700 hover:bg-audiomind-gray-200 hover:text-audiomind-black'
                  }`}
                >
                  {isRecording ? 'Stop' : 'Record'}
                </button>

                {(currentTranscript || partialTranscript) && (
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={isProcessing}
                    className={`px-6 py-2 rounded-full font-medium transition-all ${
                      isProcessing
                        ? 'opacity-50 cursor-not-allowed'
                        : isDark
                          ? 'bg-audiomind-gray-900 text-audiomind-gray-300 hover:bg-audiomind-gray-800 hover:text-audiomind-white'
                          : 'bg-audiomind-gray-100 text-audiomind-gray-700 hover:bg-audiomind-gray-200 hover:text-audiomind-black'
                    }`}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Chat Panel */}
        <div className={`flex flex-col h-full ${transcriptEnabled ? 'w-1/2' : 'w-full'}`}>
          <div
            className={`p-4 border-b ${isDark ? 'border-audiomind-gray-900' : 'border-audiomind-gray-200'} flex-shrink-0`}
          >
            <h2
              className={`text-sm font-medium ${isDark ? 'text-audiomind-gray-300' : 'text-audiomind-gray-700'}`}
            >
              Conversation
            </h2>
          </div>
          <div ref={responseRef} className="flex-1 overflow-y-scroll p-4">
            {messages.length === 0 && !currentStreamingMessage && (
              <p
                className={`${isDark ? 'text-audiomind-gray-600' : 'text-audiomind-gray-400'} text-sm`}
              >
                No conversation yet
              </p>
            )}

            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`${message.role === 'user' ? 'ml-6' : 'mr-6'}`}
                >
                  <div
                    className={`text-xs ${isDark ? 'text-audiomind-gray-600' : 'text-audiomind-gray-400'} mb-1 px-1`}
                  >
                    {message.role === 'user' ? 'You' : 'AudioMind'}
                  </div>
                  <div
                    className={`p-3 rounded-lg text-sm leading-relaxed ${
                      message.role === 'user'
                        ? isDark
                          ? 'bg-audiomind-gray-900 text-audiomind-gray-200'
                          : 'bg-audiomind-gray-100 text-audiomind-gray-800'
                        : isDark
                          ? 'bg-audiomind-gray-800 text-audiomind-gray-100'
                          : 'bg-audiomind-gray-900 text-audiomind-gray-100'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <MarkdownRenderer
                        content={message.content}
                        forceColors={{
                          text: 'text-audiomind-gray-100',
                          heading: 'text-audiomind-white',
                          code: 'text-audiomind-gray-200',
                          codeBg:
                            'bg-audiomind-gray-900 border-audiomind-gray-700',
                          quoteBg: 'bg-audiomind-gray-700',
                          quoteBorder: 'border-audiomind-gray-500',
                          link: 'text-audiomind-gray-200 hover:text-audiomind-white',
                          linkHover:
                            'decoration-audiomind-gray-500 hover:decoration-audiomind-gray-300',
                        }}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {currentStreamingMessage && (
                <div className="mr-6">
                  <div
                    className={`text-xs ${isDark ? 'text-audiomind-gray-600' : 'text-audiomind-gray-400'} mb-1 px-1`}
                  >
                    AudioMind
                  </div>
                  <div
                    className={`p-3 rounded-lg text-sm leading-relaxed ${
                      isDark
                        ? 'bg-audiomind-gray-800 text-audiomind-gray-100'
                        : 'bg-audiomind-gray-900 text-audiomind-gray-100'
                    }`}
                  >
                    <MarkdownRenderer
                      content={currentStreamingMessage}
                      forceColors={{
                        text: 'text-audiomind-gray-100',
                        heading: 'text-audiomind-white',
                        code: 'text-audiomind-gray-200',
                        codeBg:
                          'bg-audiomind-gray-900 border-audiomind-gray-700',
                        quoteBg: 'bg-audiomind-gray-700',
                        quoteBorder: 'border-audiomind-gray-500',
                        link: 'text-audiomind-gray-200 hover:text-audiomind-white',
                        linkHover:
                          'decoration-audiomind-gray-500 hover:decoration-audiomind-gray-300',
                      }}
                    />
                    <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Toast */}
      {pipelineError && (
        <div
          className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg animate-slide-up ${
            isDark
              ? 'bg-audiomind-gray-900 text-audiomind-gray-200'
              : 'bg-audiomind-gray-100 text-audiomind-gray-800'
          }`}
        >
          <p className="text-sm">{pipelineError}</p>
        </div>
      )}
    </div>
  );
}

export default AudioAIInterface;
