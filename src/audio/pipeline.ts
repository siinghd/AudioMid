/**
 * Audio processing pipeline
 * Connects native audio capture → resampling → OpenAI Realtime Conversation
 */

import { EventEmitter } from 'events';
import RealtimeConversation from '../openai/realtime';
import {
  destroyResampler,
  floatToPcm16,
  initializeResampler,
  resample48to24,
} from './pcm16';

interface VADConfig {
  enabled: boolean;
  mode: 'server' | 'semantic';
  threshold?: number; // server VAD only
  silenceMs?: number; // server VAD only
  eagerness?: 'low' | 'medium' | 'high' | 'auto'; // semantic VAD only
  interruptResponse?: boolean; // semantic VAD only
}

interface PipelineConfig {
  openaiApiKey: string;
  systemPrompt?: string;
  bufferSizeMs?: number;
  enableVAD?: boolean;
  vadThreshold?: number;
  vad?: VADConfig;
  wantTranscripts?: boolean;
  wantText?: boolean;
  voice?: string;
  transcriptionModel?: 'gpt-4o-transcribe' | 'whisper-1';
}

interface PipelineStats {
  audioChunksProcessed: number;
  userTranscriptsReceived: number;
  aiResponsesReceived: number;
  lastActivity: number | null;
  isConnected: boolean;
  isProcessing: boolean;
}

export default class AudioPipeline extends EventEmitter {
  private realtimeConversation: RealtimeConversation;
  private isInitialized = false;
  private isRunning = false;
  private bufferSizeMs: number;
  private enableVAD: boolean;
  private vadThreshold: number;
  private stats: PipelineStats;
  private audioBuffer: Float32Array[] = [];
  private lastUserTranscript = '';
  private lastAiResponse = '';
  private currentAiTextResponse = '';

  // Production-grade WebRTC VAD state machine
  private speaking = false;
  private voicedFrames = 0;
  private silentFrames = 0;
  private bytesSent = 0;
  private noiseFloor = -55; // dBFS
  private audioCapture: any = null; // Will be set by main.ts
  private lastAudioTime = 0; // Track when we last received audio
  private silenceCheckInterval: NodeJS.Timeout | null = null;

  // Production VAD constants for WebRTC VAD
  private readonly HOLD_MS = 200; // Min voiced duration to start
  private readonly RELEASE_MS = 2000; // Silence (ms) needed to stop speaking as per new requirement
  private readonly VAD_SAMPLE_RATE = 48000; // WebRTC VAD supported rate
  private readonly VAD_FRAME_MS = 20; // WebRTC VAD frame duration (10, 20, or 30ms)
  private readonly VAD_SAMPLES_PER_FRAME = 960; // 48000 * 20 / 1000 = 960 samples
  private readonly NOISE_ADAPT_RATE = 0.01; // Adaptive noise floor rate

  constructor(config: PipelineConfig) {
    super();

    this.bufferSizeMs = config.bufferSizeMs || 1000;
    this.enableVAD = config.enableVAD !== false;
    this.vadThreshold = config.vadThreshold || 0.02;

    // Build turn detection config based on VAD settings
    let turnDetection;
    if (config.vad) {
      if (config.vad.mode === 'semantic') {
        turnDetection = {
          type: 'semantic_vad' as const,
          eagerness: config.vad.eagerness || 'auto',
          create_response: true,
          interrupt_response: config.vad.interruptResponse !== false,
        };
      } else {
        turnDetection = {
          type: 'server_vad' as const,
          threshold: config.vad.threshold || 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: config.vad.silenceMs || 600,
          create_response: true,
        };
      }
    } else {
      // Default to server VAD with backward compatibility
      turnDetection = {
        type: 'server_vad' as const,
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 600,
        create_response: true,
      };
    }

    // Initialize OpenAI Realtime Conversation
    this.realtimeConversation = new RealtimeConversation({
      apiKey: config.openaiApiKey,
      model: 'gpt-4o-realtime-preview-2025-06-03',
      systemPrompt: config.systemPrompt,
      voice: config.voice,
      turnDetection,
      wantText: config.wantText !== false,
      wantTranscripts: config.wantTranscripts !== false,
      transcriptionModel: config.transcriptionModel,
    });

    // Initialize stats
    this.stats = {
      audioChunksProcessed: 0,
      userTranscriptsReceived: 0,
      aiResponsesReceived: 0,
      lastActivity: null,
      isConnected: false,
      isProcessing: false,
    };

    // WebRTC VAD will be initialized through audio capture module

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Realtime Conversation event handlers
    this.realtimeConversation.on('session.created', () => {
      // Realtime session created
      this.stats.isConnected = true;
      this.emit('stt.connected');
    });

    // User speech events
    this.realtimeConversation.on('speech_started', () => {
      // User started speaking
      this.emit('user.speech_started');
    });

    this.realtimeConversation.on('speech_stopped', () => {
      // User stopped speaking
      this.emit('user.speech_stopped');
    });

    this.realtimeConversation.on('user_transcript', (text: string) => {
      // User transcript received
      this.lastUserTranscript = text;
      this.stats.userTranscriptsReceived++;
      this.stats.lastActivity = Date.now();
      this.emit('transcript.final', text);
    });

    // AI response events (text)
    this.realtimeConversation.on('response_started', () => {
      // AI response started
      this.currentAiTextResponse = '';
      this.emit('ai.response_started');
    });

    this.realtimeConversation.on('ai_text_delta', (chunk: string) => {
      // AI text delta received
      this.currentAiTextResponse += chunk;
      this.emit('chat.chunk', chunk);
    });

    this.realtimeConversation.on('ai_text_done', () => {
      // AI text response completed
      this.lastAiResponse = this.currentAiTextResponse;
      this.stats.aiResponsesReceived++;
      this.stats.lastActivity = Date.now();
      this.emit('chat.response', { content: this.currentAiTextResponse });
    });
    
    // Handle AI audio transcript (optional - what the AI is saying)
    this.realtimeConversation.on('ai_audio_transcript_delta', (chunk: string) => {
      // Could display this in UI if desired
      this.emit('ai.audio_transcript_delta', chunk);
    });
    
    this.realtimeConversation.on('ai_audio_transcript_done', (transcript: string) => {
      // Full transcript of what AI said
      this.emit('ai.audio_transcript_done', transcript);
    });

    // AI response events (audio)
    this.realtimeConversation.on('ai_audio_delta', (audioBuffer: Buffer) => {
      this.emit('ai.audio_chunk', audioBuffer);
    });

    this.realtimeConversation.on('ai_audio_done', () => {
      // AI audio response completed
      this.emit('ai.audio_done');
    });

    this.realtimeConversation.on('response_completed', () => {
      // Full AI response completed
      this.emit('ai.response_completed');
    });

    // Error and connection events
    this.realtimeConversation.on('error', (error: Error) => {
      console.error('❌ Realtime error:', error);
      this.stats.isConnected = false;
      this.emit('stt.error', error);
    });

    this.realtimeConversation.on('closed', (code: number, reason: string) => {
      // Realtime connection closed
      this.stats.isConnected = false;
      this.emit('stt.closed', code, reason);
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      // Pipeline already initialized
      return;
    }

    try {
      // Initializing audio pipeline

      // Initialize high-quality resampler first
      await initializeResampler();

      // Connect to OpenAI Realtime API
      await this.realtimeConversation.connect();

      // Set up periodic maintenance (every 5 minutes)
      setInterval(
        () => {
          this.realtimeConversation.checkSessionAge();
          this.realtimeConversation.cleanupPendingEvents();
        },
        5 * 60 * 1000,
      );

      this.isInitialized = true;
      // Audio pipeline initialized
      this.emit('initialized');
    } catch (error) {
      console.error('❌ Pipeline initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  start(): void {
    if (!this.isInitialized) {
      throw new Error('Pipeline not initialized. Call initialize() first.');
    }

    if (this.isRunning) {
      // Pipeline already running
      return;
    }

    // Starting audio pipeline
    this.isRunning = true;
    this.stats.lastActivity = Date.now();
    this.lastAudioTime = Date.now(); // Initialize to prevent immediate timeout

    // Start checking for silence when no audio events are received
    this.startSilenceDetection();

    this.emit('started');
  }

  stop(): void {
    if (!this.isRunning) {
      // Pipeline already stopped
      return;
    }

    // Stopping audio pipeline
    this.isRunning = false;

    // Stop silence detection
    this.stopSilenceDetection();

    this.emit('stopped');
  }

  // Main audio processing function - Production WebRTC VAD implementation
  processAudioChunk(float32Data: Float32Array): boolean {
    if (!this.isRunning || !this.realtimeConversation.isReady()) {
      return false;
    }

    try {
      this.stats.audioChunksProcessed++;
      this.stats.isProcessing = true;

      // Update last audio time - we received audio data
      this.lastAudioTime = Date.now();

      // 1) WebRTC VAD decision at 48kHz (before downsampling)
      let speech = false;
      if (this.audioCapture && this.audioCapture.isVADInitialized()) {
        try {
          // Convert 48kHz float32 to int16 for WebRTC VAD
          const pcm48Data = floatToPcm16(float32Data);

          let framesProcessed = 0;
          let speechFrames = 0;

          // Debug: Log input size
          if (this.stats.audioChunksProcessed % 50 === 0) {
            console.log(
              `🔍 [VAD Debug] Input: ${pcm48Data.length} samples, ${Math.floor(pcm48Data.length / this.VAD_SAMPLES_PER_FRAME)} complete frames`,
            );
          }

          for (
            let offset = 0;
            offset + this.VAD_SAMPLES_PER_FRAME <= pcm48Data.length;
            offset += this.VAD_SAMPLES_PER_FRAME
          ) {
            // Create buffer with exact byte offset and length for 960 samples (1920 bytes)
            const frameBuffer = Buffer.from(
              pcm48Data.buffer,
              pcm48Data.byteOffset + offset * 2, // offset in bytes (2 bytes per sample)
              this.VAD_SAMPLES_PER_FRAME * 2, // 960 samples * 2 bytes = 1920 bytes
            );

            const frameHasSpeech = this.audioCapture.processVAD(frameBuffer);
            framesProcessed += 1;

            // Accumulate speech across all frames instead of short-circuiting.
            if (frameHasSpeech) {
              speech = true;
              speechFrames += 1;
            }
          }

          // Debug: Log frame results
          if (this.stats.audioChunksProcessed % 50 === 0) {
            console.log(
              `🔍 [VAD Debug] Processed ${framesProcessed} frames: ${speechFrames} speech, ${framesProcessed - speechFrames} silence`,
            );
          }

          // Log VAD processing every 100th chunk
          if (this.stats.audioChunksProcessed % 100 === 0) {
            console.log(
              `🎤 [WebRTC VAD] Processed ${framesProcessed} frames, speech: ${speech}`,
            );
          }
        } catch (error) {
          console.warn('WebRTC VAD error, falling back to RMS:', error);
          speech = this.hasVoiceActivityRMS(float32Data);
        }
      } else {
        if (this.stats.audioChunksProcessed % 100 === 0) {
          console.log('⚠️ Using RMS VAD fallback - WebRTC VAD not initialized');
        }
        speech = this.hasVoiceActivityRMS(float32Data);
      }

      // 2) Downsample to 24kHz for OpenAI AFTER VAD decision
      const resampled24k = resample48to24(float32Data);
      const pcm16Data = floatToPcm16(resampled24k);

      // Update adaptive noise floor when not speaking
      if (!speech) {
        const rmsDb = this.calculateRmsDb(pcm16Data);
        this.noiseFloor =
          this.noiseFloor * (1 - this.NOISE_ADAPT_RATE) +
          rmsDb * this.NOISE_ADAPT_RATE;
      }

      // 3) VAD state machine with hysteresis
      if (speech) {
        this.voicedFrames += 1;
        this.silentFrames = 0;

        // Start speaking after HOLD_MS of continuous voice
        if (
          !this.speaking &&
          this.voicedFrames * this.VAD_FRAME_MS >= this.HOLD_MS
        ) {
          console.log(
            `🎤 [WebRTC VAD] Speech STARTED (held for ${this.voicedFrames * this.VAD_FRAME_MS}ms)`,
          );
          console.log(`   📊 Noise floor: ${this.noiseFloor.toFixed(1)} dBFS`);
          this.speaking = true;
          this.emit('user.speech_started');
        }
      } else {
        this.silentFrames += 1;

        // Stop speaking after RELEASE_MS of continuous silence
        if (
          this.speaking &&
          this.silentFrames * this.VAD_FRAME_MS >= this.RELEASE_MS
        ) {
          console.log(
            `🛑 [WebRTC VAD] Speech STOPPED after ${this.silentFrames * this.VAD_FRAME_MS}ms silence`,
          );
          console.log(
            `   📊 Total bytes sent: ${this.bytesSent}, voiced frames: ${this.voicedFrames}`,
          );

          this.speaking = false;
          
          // Only close turn if we actually sent meaningful audio (at least 100ms worth)
          // 48000 Hz * 0.1s * 2 bytes/sample = 9600 bytes minimum
          if (this.bytesSent >= 9600) {
            // Close the turn
            this.realtimeConversation.closeTurn();
          } else {
            console.log(`   ⚠️ Not closing turn - insufficient audio (${this.bytesSent} bytes < 9600 bytes)`);
          }
          
          this.voicedFrames = 0;
          this.silentFrames = 0;
          this.bytesSent = 0;
          
          this.emit('user.speech_stopped');
        }
      }

      // 4) Stream audio only while speaking
      if (this.speaking) {
        const success = this.realtimeConversation.pushPCM(pcm16Data);

        if (success) {
          this.bytesSent += pcm16Data.byteLength;
          this.stats.lastActivity = Date.now();
          this.emit('audio.processed', {
            inputSamples: float32Data.length,
            outputSamples: pcm16Data.length,
            sampleRate: 24000,
          });
        }

        this.stats.isProcessing = false;
        return success;
      }

      // No audio sent when not speaking
      this.stats.isProcessing = false;
      return true;
    } catch (error) {
      console.error('❌ Audio processing error:', error);
      this.stats.isProcessing = false;
      this.emit('audio.error', error);
      return false;
    }
  }

  // Simple VAD implementation with debouncing
  private vadLogCounter = 0;
  private lastVadState: boolean | null = null;
  private prevRms = 0;
  private voiceFrames = 0;
  private readonly VOICE_DEBOUNCE_FRAMES = 3; // Require 3 consecutive frames to change state

  private hasVoiceActivity(audioData: Float32Array): boolean {
    if (!this.enableVAD) return true;

    // Calculate RMS level
    let rms = 0;
    for (let i = 0; i < audioData.length; i++) {
      rms += audioData[i] * audioData[i];
    }
    rms = Math.sqrt(rms / audioData.length);

    // Apply low-pass filter to smooth RMS
    const smoothedRms = 0.7 * this.prevRms + 0.3 * rms;
    this.prevRms = smoothedRms;

    const rmsAboveThreshold = smoothedRms > this.vadThreshold;

    // Debounce logic - require multiple frames to change state
    if (rmsAboveThreshold) {
      this.voiceFrames = Math.min(
        this.voiceFrames + 1,
        this.VOICE_DEBOUNCE_FRAMES,
      );
    } else {
      this.voiceFrames = Math.max(this.voiceFrames - 1, 0);
    }

    // Only change voice state after debounce
    const hasVoice = this.voiceFrames >= this.VOICE_DEBOUNCE_FRAMES;

    // Log VAD state changes or periodically during speech
    this.vadLogCounter++;
    if (
      hasVoice !== this.lastVadState ||
      (hasVoice && this.vadLogCounter % 100 === 0)
    ) {
      console.log(
        `🎙️ [Local VAD] RMS: ${rms.toFixed(4)} (smoothed: ${smoothedRms.toFixed(4)}), Threshold: ${this.vadThreshold}, Has Voice: ${hasVoice}`,
      );
      this.lastVadState = hasVoice;
    }

    return hasVoice;
  }

  // No longer needed - chat completion is handled by Realtime API directly

  // Utility methods
  getStats(): PipelineStats {
    return { ...this.stats };
  }

  // Get current turn status
  getTurnStatus(): {
    isSpeaking: boolean;
    silentFrames: number;
    bytesSent: number;
  } {
    return {
      isSpeaking: this.speaking,
      silentFrames: this.silentFrames,
      bytesSent: this.bytesSent,
    };
  }

  getCurrentTranscript(): string {
    return this.lastUserTranscript;
  }

  getCurrentAiResponse(): string {
    return this.currentAiTextResponse || this.lastAiResponse;
  }

  clearTranscriptHistory(): void {
    this.lastUserTranscript = '';
    this.lastAiResponse = '';
    this.currentAiTextResponse = '';
    console.log('🗑️ Transcript history cleared');
  }

  updateSystemPrompt(_prompt: string): void {
    // System prompt is configured in session initialization
    // Would need to reconnect to update
    console.log('📝 System prompt update requires reconnection');
  }

  isReady(): boolean {
    return this.isInitialized && this.realtimeConversation.isReady();
  }

  disconnect(): void {
    // Disconnecting audio pipeline

    this.stop();
    this.realtimeConversation.disconnect();

    // Clean up resampler resources
    destroyResampler();

    // Clean up silence detection
    this.stopSilenceDetection();

    this.isInitialized = false;
    this.stats.isConnected = false;

    this.emit('disconnected');
  }

  // Helper methods for WebRTC VAD implementation
  private hasVoiceActivityRMS(audioData: Float32Array): boolean {
    if (!this.enableVAD) return true;

    // Calculate RMS level
    let rms = 0;
    for (let i = 0; i < audioData.length; i += 1) {
      rms += audioData[i] * audioData[i];
    }
    rms = Math.sqrt(rms / audioData.length);

    // Apply low-pass filter to smooth RMS
    const smoothedRms = 0.7 * this.prevRms + 0.3 * rms;
    this.prevRms = smoothedRms;

    return smoothedRms > this.vadThreshold;
  }

  private calculateRmsDb(pcm16Data: Int16Array): number {
    let rms = 0;
    for (let i = 0; i < pcm16Data.length; i += 1) {
      const sample = pcm16Data[i] / 32768.0; // Normalize to [-1, 1]
      rms += sample * sample;
    }
    rms = Math.sqrt(rms / pcm16Data.length);

    // Convert to dBFS (decibels relative to full scale)
    return rms > 0 ? 20 * Math.log10(rms) : -120;
  }

  // Configure VAD settings
  setVADConfig(enabled: boolean, threshold: number = 0.02): void {
    this.enableVAD = enabled;
    this.vadThreshold = threshold;
    console.log(
      `🎙️ VAD configured: enabled=${enabled}, threshold=${threshold}`,
    );
  }

  // Set audio capture reference for embedded WebRTC VAD
  setAudioCapture(audioCapture: any): void {
    this.audioCapture = audioCapture;
    console.log('🔗 Audio capture reference set for embedded WebRTC VAD');
  }

  // Start silence detection based on absence of audio events
  private startSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    // Check every 50ms if we haven't received audio
    this.silenceCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastAudio = now - this.lastAudioTime;

      // Only check for silence timeout if we're currently speaking
      // and not during AI responses or other audio playback
      if (this.speaking && this.isRunning && timeSinceLastAudio >= this.RELEASE_MS) {
        console.log(
          `🛑 [Silence Timeout] No audio received for ${timeSinceLastAudio}ms - stopping speech`,
        );
        console.log(
          `   📊 Total bytes sent: ${this.bytesSent}, voiced frames: ${this.voicedFrames}`,
        );

        this.speaking = false;
        
        // Only close turn if we actually sent meaningful audio (at least 100ms worth)
        if (this.bytesSent >= 9600) {
          // Close the turn
          this.realtimeConversation.closeTurn();
        } else {
          console.log(`   ⚠️ Not closing turn - insufficient audio (${this.bytesSent} bytes < 9600 bytes)`);
        }
        
        this.voicedFrames = 0;
        this.silentFrames = 0;
        this.bytesSent = 0;
        
        this.emit('user.speech_stopped');
      }
    }, 50);
  }

  // Stop silence detection
  private stopSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
  }
}
