/**
 * OpenAI Audio Provider
 * Uses the unified audio system with OpenAI-specific customizations
 */

import fs from 'fs';
import path from 'path';
import RealtimeConversation from '../../openai/realtime';
import {
  AudioProviderConfig,
  BaseAudioProvider,
} from '../audio-provider-interface';
import {
  destroyResampler,
  floatToPcm16,
  initializeResampler,
  resample48to24,
} from '../pcm16';

interface OpenAIConfig extends AudioProviderConfig {
  providerSpecific?: {
    model?: string;
    voice?: string;
    wantTranscripts?: boolean;
    wantText?: boolean;
    transcriptionModel?: 'gpt-4o-transcribe' | 'whisper-1';
  };
}

export class OpenAIAudioProvider extends BaseAudioProvider {
  private realtimeConversation: RealtimeConversation;
  private lastUserTranscript = '';
  private lastAiResponse = '';
  private currentAiTextResponse = '';
  // Remove this - it's now in BaseAudioProvider
  protected lastAudioTime = 0;
  // Debug: dump raw audio chunks
  private stageDumpCount = 0;
  private dumpRawAudio = false;
  
  // Track which type of response we're receiving to prevent duplicates
  private receivingTextResponse = false;
  
  // Remove audio buffering - back to streaming approach

  constructor(config: OpenAIConfig) {
    super(config);
    this.setupRealtimeConversation();

    // Disable audio dumping for now to focus on fixing the repetition issue
    // this.enableAudioDump();
  }

  private setupRealtimeConversation(): void {
    const openaiConfig = this.config.providerSpecific || {};

    this.realtimeConversation = new RealtimeConversation({
      apiKey: this.config.apiKey,
      model: openaiConfig.model || 'gpt-4o-realtime-preview-2025-06-03',
      systemPrompt:
        this.config.systemPrompt ||
        'You are a helpful AI assistant. Respond naturally and concisely to what the user is saying.',
      voice: openaiConfig.voice || 'alloy',
      turnDetection: undefined, // Disable server VAD - use only WebRTC VAD
      wantText: openaiConfig.wantText !== false,
      wantTranscripts: openaiConfig.wantTranscripts !== false,
      transcriptionModel: openaiConfig.transcriptionModel || 'whisper-1',
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Session events
    this.realtimeConversation.on('session.created', () => {
      this.stats.isConnected = true;
      this.emit('stt.connected');
    });

    // User speech events (from OpenAI server)
    this.realtimeConversation.on('speech_started', () => {
      this.emit('user.speech_started');
    });

    this.realtimeConversation.on('speech_stopped', () => {
      this.emit('user.speech_stopped');
    });

    // User transcript events
    this.realtimeConversation.on('user_transcript', (text: string) => {
      this.lastUserTranscript = text;
      this.stats.userTranscriptsReceived++;
      this.stats.lastActivity = Date.now();
      this.emit('transcript.final', text);
    });

    // AI response events (text)
    this.realtimeConversation.on('response_started', () => {
      this.currentAiTextResponse = '';
      this.receivingTextResponse = false; // Reset flag for new response
      this.emit('ai.response_started');
    });

    this.realtimeConversation.on('ai_text_delta', (chunk: string) => {
      this.currentAiTextResponse += chunk;
      this.receivingTextResponse = true; // Mark that we're getting direct text
      this.emit('chat.chunk', chunk);
    });

    this.realtimeConversation.on('ai_text_done', () => {
      this.lastAiResponse = this.currentAiTextResponse;
      this.stats.aiResponsesReceived++;
      this.stats.lastActivity = Date.now();
      this.emit('chat.response', { content: this.currentAiTextResponse });
    });

    // AI audio transcript events (fallback if no direct text response)
    this.realtimeConversation.on(
      'ai_audio_transcript_delta',
      (chunk: string) => {
        // Only use audio transcript if we're not receiving direct text
        if (!this.receivingTextResponse) {
          this.emit('chat.chunk', chunk);
        }
      },
    );

    this.realtimeConversation.on(
      'ai_audio_transcript_done',
      (transcript: string) => {
        this.emit('ai.audio_transcript_done', transcript);
      },
    );

    // AI audio events
    this.realtimeConversation.on('ai_audio_delta', (audioBuffer: Buffer) => {
      this.emit('ai.audio_chunk', audioBuffer);
    });

    this.realtimeConversation.on('ai_audio_done', () => {
      this.emit('ai.audio_done');
    });

    this.realtimeConversation.on('response_completed', () => {
      this.emit('ai.response_completed');
    });

    // Error and connection events
    this.realtimeConversation.on('error', (error: Error) => {
      console.error('❌ OpenAI Realtime error:', error);
      this.stats.isConnected = false;
      this.emit('stt.error', error);
    });

    this.realtimeConversation.on('closed', (code: number, reason: string) => {
      this.stats.isConnected = false;
      this.emit('stt.closed', code, reason);
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initializing OpenAI audio provider

      // Initialize high-quality resampler
      await initializeResampler();

      // Connect to OpenAI Realtime API
      await this.realtimeConversation.connect();

      // Set up periodic maintenance
      setInterval(
        () => {
          this.realtimeConversation.checkSessionAge();
          this.realtimeConversation.cleanupPendingEvents();
        },
        5 * 60 * 1000,
      );

      this.isInitialized = true;
      // OpenAI audio provider initialized
      this.emit('initialized');
    } catch (error) {
      console.error('❌ OpenAI provider initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  start(): void {
    if (!this.isInitialized) {
      throw new Error(
        'OpenAI provider not initialized. Call initialize() first.',
      );
    }

    if (this.isRunning) return;

    // Starting OpenAI audio provider
    this.isRunning = true;
    this.stats.lastActivity = Date.now();
    this.lastAudioTime = Date.now();

    this.startSilenceDetection();
    this.startSilenceTimeout(); // Use unified silence timeout
    this.emit('started');
  }

  stop(): void {
    if (!this.isRunning) return;

    // Stopping OpenAI audio provider
    this.isRunning = false;
    this.stopSilenceDetection();
    this.emit('stopped');
  }

  disconnect(): void {
    // Disconnecting OpenAI audio provider

    this.stop();
    this.realtimeConversation.disconnect();
    destroyResampler();
    this.stopSilenceDetection();

    this.isInitialized = false;
    this.stats.isConnected = false;
    this.emit('disconnected');
  }

  isReady(): boolean {
    return this.isInitialized && this.realtimeConversation.isReady();
  }

  updateSystemPrompt(_prompt: string): void {
    // System prompt update requires reconnection
  }

  getCurrentTranscript(): string {
    return this.lastUserTranscript;
  }

  // Audio debugging methods
  enableAudioDump(outputPath?: string): void {
    this.realtimeConversation.enableAudioDump(outputPath);
  }

  disableAudioDump(): void {
    this.realtimeConversation.disableAudioDump();
  }

  setDebugSettings(settings: { dumpRawAudio?: boolean; dumpApiAudio?: boolean }): void {
    if (settings.dumpRawAudio !== undefined) {
      this.dumpRawAudio = settings.dumpRawAudio;
      if (this.dumpRawAudio) {
        console.log('🎧 [OpenAI] Raw audio dump enabled');
      } else {
        console.log('🎧 [OpenAI] Raw audio dump disabled');
      }
    }

    if (settings.dumpApiAudio !== undefined) {
      if (settings.dumpApiAudio) {
        this.enableAudioDump();
      } else {
        this.disableAudioDump();
      }
    }
  }

  protected getTargetAudioFormat(): {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
  } {
    // Mono 24 kHz 16-bit PCM – matches "pcm16" declared in realtime.ts
    return { sampleRate: 24000, channels: 1, bitsPerSample: 16 };
  }

  protected processProviderAudio(raw48Mono: Float32Array): void {
    // OpenAI-specific audio processing: 48kHz mono → 24 kHz → PCM16
    // Only process audio when actively speaking to avoid sending silence

    // Audio is already mono from audioCapture.getBufferedFloat32Audio()
    const mono48 = raw48Mono;

    // Debug dump raw48Mono before any conversion
    if (this.dumpRawAudio) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dumpPath = path.join(
        process.cwd(),
        `raw48Mono-${ts}-${this.stageDumpCount}.pcm`,
      );
      try {
        const int16raw = floatToPcm16(raw48Mono);
        fs.writeFileSync(dumpPath, Buffer.from(int16raw.buffer));
        console.log(
          `📥 [Debug] Dumped raw 48k mono chunk to ${dumpPath} (ffplay -f s16le -ar 48000 -ac 1 ${dumpPath})`,
        );
        this.stageDumpCount++;
      } catch (err) {
        console.warn('❌ Failed to write raw dump:', err);
      }
    }

    // 2. Down-sample to 24 kHz
    const mono24 = resample48to24(mono48);

    // 3. Float32 → 16-bit PCM
    const pcm16 = floatToPcm16(mono24);

    // Update last audio time
    this.lastAudioTime = Date.now();

    // 4. Stream audio chunks immediately during speech (back to streaming approach)
    if (this.speaking) {
      // Send audio chunk immediately
      const success = this.realtimeConversation.pushPCM(pcm16);
      if (success) {
        this.bytesSent += pcm16.byteLength;
        this.stats.bytesSent = this.bytesSent;
        this.stats.lastActivity = Date.now();
        
        console.log(`📤 [Audio Stream] Sent chunk: ${pcm16.length} samples (${pcm16.byteLength} bytes), total: ${this.bytesSent} bytes`);
      }
      
      this.emit('audio.processed', {
        inputSamples: raw48Mono.length,
        outputSamples: pcm16.length,
        sampleRate: 24000,
      });
    } else {
      // Don't send audio when not speaking
      this.emit('audio.processed', {
        inputSamples: raw48Mono.length,
        outputSamples: 0, // No audio sent
        sampleRate: 24000,
      });
    }
  }

  // Override VAD state management to include OpenAI-specific turn logic (like pipeline.ts)
  // This completely replaces the BaseAudioProvider's VAD logic
  protected updateVADState(speech: boolean): void {
    if (speech) {
      this.voicedFrames += 1;
      this.silentFrames = 0;

      // Start speaking after HOLD_MS of continuous voice
      if (!this.speaking && this.voicedFrames * this.VAD_FRAME_MS >= this.config.vadConfig.holdMs) {
        console.log(
          `🎙️ [OpenAI VAD] Speech STARTED (held for ${this.voicedFrames * this.VAD_FRAME_MS}ms)`
        );
        this.speaking = true;
        this.stats.speaking = true;
        // Reset counters when starting new speech
        this.bytesSent = 0;
        this.stats.bytesSent = 0;
        this.emit('user.speech_started');
      }
    } else {
      this.silentFrames += 1;
      // Don't reset voicedFrames here - only reset when speech actually stops

      // OpenAI-specific turn management logic (like pipeline.ts:407-435)
      if (this.speaking && this.silentFrames * this.VAD_FRAME_MS >= this.config.vadConfig.releaseMs) {
        console.log(
          `🛑 [OpenAI VAD] Speech STOPPED after ${this.silentFrames * this.VAD_FRAME_MS}ms silence`
        );
        console.log(
          `   📊 Total bytes sent: ${this.bytesSent}, voiced frames: ${this.voicedFrames}, silent frames: ${this.silentFrames}`
        );

        this.speaking = false;
        this.stats.speaking = false;
        
        // Close turn using streaming approach - audio chunks already sent
        const MIN_BYTES_TO_CLOSE = 4800;
        if (this.bytesSent >= MIN_BYTES_TO_CLOSE) {
          this.realtimeConversation.closeTurn();
          console.log(`   ✅ Turn closed (${this.bytesSent} bytes sent via streaming)`);
        } else {
          console.log(`   ⚠️ Not closing turn - insufficient audio (${this.bytesSent} bytes < ${MIN_BYTES_TO_CLOSE} bytes)`);
        }
        
        // Reset everything for next turn
        this.voicedFrames = 0;
        this.silentFrames = 0;
        this.bytesSent = 0;
        this.stats.bytesSent = 0;
        
        this.emit('user.speech_stopped');
      }
    }

    // Fallback: if we've been "speaking" for more than 30 seconds, force stop
    if (this.speaking && this.voicedFrames * this.VAD_FRAME_MS > 30000) {
      console.log(`⚠️ [OpenAI VAD] Forcing speech stop after 30 seconds`);
      this.speaking = false;
      this.stats.speaking = false;
      this.voicedFrames = 0;
      this.silentFrames = 0;
      this.realtimeConversation.closeTurn();
      this.bytesSent = 0;
      this.stats.bytesSent = 0;
      this.emit('user.speech_stopped');
    }
  }

  protected onSpeechStarted(): void {
    // Not used - turn management handled in updateVADState
  }

  protected onSpeechStopped(): void {
    // Not used - turn management handled in updateVADState
  }

  // Silence detection for when no audio events are received
  private startSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    this.silenceCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastAudio = now - this.lastAudioTime;

      if (
        this.speaking &&
        this.isRunning &&
        timeSinceLastAudio >= this.config.vadConfig.releaseMs
      ) {
        console.log(
          `🛑 [OpenAI Silence Timeout] No audio for ${timeSinceLastAudio}ms - stopping speech`,
        );
        this.speaking = false;
        this.stats.speaking = false;
        this.onSpeechStopped();
        this.emit('user.speech_stopped');
      }
    }, 50);
  }

  private stopSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
  }
}
