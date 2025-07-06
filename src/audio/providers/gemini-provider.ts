/**
 * Gemini Audio Provider
 * Uses the unified audio system with Gemini-specific customizations
 */

import { BaseAudioProvider, AudioProviderConfig } from '../audio-provider-interface';
import GeminiLiveAPI from '../../gemini/live-api';

interface GeminiConfig extends AudioProviderConfig {
  providerSpecific?: {
    model?: 'gemini-2.5-flash-preview-native-audio-dialog' | 'gemini-live-2.5-flash-preview' | 'gemini-2.0-flash-live-001';
    audioArchitecture?: 'native' | 'half-cascade';
    responseModalities?: string[];
    voiceName?: string;
  };
}

export class GeminiAudioProvider extends BaseAudioProvider {
  private geminiAPI: GeminiLiveAPI;
  private lastUserTranscript = '';
  private silenceCheckInterval: NodeJS.Timeout | null = null;
  private receivingResponse = false;

  constructor(config: GeminiConfig) {
    super(config);
    this.setupGeminiAPI();
  }

  private setupGeminiAPI(): void {
    const geminiConfig = this.config.providerSpecific || {};

    this.geminiAPI = new GeminiLiveAPI({
      apiKey: this.config.apiKey,
      model: geminiConfig.model || 'gemini-live-2.5-flash-preview',
      systemInstruction: this.config.systemPrompt || 'You are a helpful AI assistant. Respond naturally and concisely to what the user is saying.',
      responseModalities: geminiConfig.responseModalities || ['AUDIO'],
      audioArchitecture: geminiConfig.audioArchitecture || 'half-cascade',
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Connection events
    this.geminiAPI.on('connected', () => {
      this.stats.isConnected = true;
      this.emit('stt.connected');
    });

    this.geminiAPI.on('disconnected', () => {
      this.stats.isConnected = false;
      this.emit('stt.closed', 1000, 'Gemini API disconnected');
    });

    // AI response events
    this.geminiAPI.on('text_chunk', (text: string) => {
      
      // Signal response start on first chunk of each turn
      if (!this.receivingResponse) {
        this.receivingResponse = true;
        this.emit('ai.response_started');
      }
      
      this.emit('chat.chunk', text);
    });

    this.geminiAPI.on('audio_chunk', (audioData: ArrayBuffer) => {
      this.emit('ai.audio_chunk', audioData);
    });

    this.geminiAPI.on('turn_complete', () => {
      this.receivingResponse = false; // Reset for next turn
      this.stats.aiResponsesReceived++;
      this.stats.lastActivity = Date.now();
      this.emit('ai.text_complete', '');
      this.emit('ai.response_completed');
    });

    this.geminiAPI.on('interrupted', () => {
      this.receivingResponse = false; // Reset on interruption
      this.emit('ai.response_interrupted');
    });

    // Transcription events
    this.geminiAPI.on('input_transcription', (text: string) => {
      this.lastUserTranscript = text;
      this.stats.userTranscriptsReceived++;
      this.stats.lastActivity = Date.now();
      this.emit('transcript.final', text);
    });

    this.geminiAPI.on('output_transcription', (text: string) => {
      this.emit('ai.audio_transcript_done', text);
    });

    // Usage metadata
    this.geminiAPI.on('usage_metadata', (metadata: any) => {
      this.emit('usage_metadata', metadata);
    });

    // Error events
    this.geminiAPI.on('error', (error: any) => {
      console.error('❌ Gemini API error:', error);
      this.stats.isConnected = false;
      this.emit('stt.error', error);
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.geminiAPI.connect();
      
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      console.error('❌ Gemini provider initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  start(): void {
    if (!this.isInitialized) {
      throw new Error('Gemini provider not initialized. Call initialize() first.');
    }

    if (this.isRunning) return;

    // Starting Gemini audio provider
    this.isRunning = true;
    this.stats.lastActivity = Date.now();
    this.lastAudioTime = Date.now();

    this.startSilenceDetection();
    this.startSilenceTimeout(); // Use unified silence timeout
    this.emit('started');
  }

  stop(): void {
    if (!this.isRunning) return;

    // Stopping Gemini audio provider
    this.isRunning = false;
    this.stopSilenceDetection();
    
    // End any active speech activity
    if (this.speaking) {
      this.geminiAPI.endSpeechActivity();
    }
    
    this.emit('stopped');
  }

  disconnect(): void {
    // Disconnecting Gemini audio provider
    
    this.stop();
    this.geminiAPI.disconnect();
    this.stopSilenceDetection();

    this.isInitialized = false;
    this.stats.isConnected = false;
    this.emit('disconnected');
  }

  isReady(): boolean {
    return this.isInitialized && this.geminiAPI.isReady();
  }

  updateSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
    this.geminiAPI.updateSystemInstruction(prompt);
    // System prompt updated
  }

  getCurrentTranscript(): string {
    return this.lastUserTranscript || 'Listening...';
  }

  protected getTargetAudioFormat(): { sampleRate: number; channels: number; bitsPerSample: number } {
    return { sampleRate: 16000, channels: 1, bitsPerSample: 16 };
  }

  // Remove custom processAudioChunk - use the unified one from BaseAudioProvider

  protected processProviderAudio(raw48Mono: Float32Array): void {
    // Gemini-specific audio processing: 48kHz mono → 16kHz mono → PCM16
    // Only process audio when actively speaking to avoid sending silence
    
    // Audio is already mono from audioCapture.getBufferedFloat32Audio()
    const mono48 = raw48Mono;
    
    // Downsample from 48kHz to 16kHz for Gemini API
    const mono16 = this.downsampleAudio(mono48, 48000, 16000);
    const pcm16 = this.float32ToPcm16(mono16);
    
    // Update last audio time
    this.lastAudioTime = Date.now();
    
    // Only send audio during speech (like OpenAI provider)
    if (this.speaking) {
      // Convert to ArrayBuffer for Gemini API
      const buffer = pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength);
      
      this.geminiAPI.sendAudioChunk(buffer);
      this.bytesSent += buffer.byteLength;
      this.stats.bytesSent = this.bytesSent;
      this.stats.lastActivity = Date.now();
      
      this.emit('audio.processed', {
        inputSamples: raw48Mono.length,
        outputSamples: pcm16.length,
        sampleRate: 16000,
      });
    } else {
      // Don't send audio when not speaking
      this.emit('audio.processed', {
        inputSamples: raw48Mono.length,
        outputSamples: 0, // No audio sent
        sampleRate: 16000,
      });
    }
  }


  // Override VAD state management - Gemini only supports internal VAD turn management
  protected updateVADState(speech: boolean): void {
    if (speech) {
      this.voicedFrames += 1;
      this.silentFrames = 0;

      // Start speaking after HOLD_MS of continuous voice
      if (!this.speaking && this.voicedFrames * this.VAD_FRAME_MS >= this.config.vadConfig.holdMs) {
        console.log(
          `🎙️ [Gemini VAD] Speech STARTED (held for ${this.voicedFrames * this.VAD_FRAME_MS}ms)`
        );
        this.speaking = true;
        this.stats.speaking = true;
        // Reset counters when starting new speech
        this.bytesSent = 0;
        this.stats.bytesSent = 0;
        this.geminiAPI.startSpeechActivity();
        this.emit('user.speech_started');
      }
    } else {
      this.silentFrames += 1;
      // Don't reset voicedFrames here - only reset when speech actually stops

      // Gemini turn management logic - only internal VAD supported
      if (this.speaking && this.silentFrames * this.VAD_FRAME_MS >= this.config.vadConfig.releaseMs) {
        console.log(
          `🛑 [Gemini VAD] Speech STOPPED after ${this.silentFrames * this.VAD_FRAME_MS}ms silence`
        );
        console.log(
          `   📊 Total bytes sent: ${this.bytesSent}, voiced frames: ${this.voicedFrames}, silent frames: ${this.silentFrames}`
        );

        this.speaking = false;
        this.stats.speaking = false;
        
        // End speech activity using streaming approach - audio chunks already sent
        // 16000 Hz * 0.1s * 1 channel * 2 bytes/sample = 3200 bytes minimum for mono
        // Use 4800 bytes to be safe for Gemini
        const MIN_BYTES_TO_CLOSE = 4800;
        if (this.bytesSent >= MIN_BYTES_TO_CLOSE) {
          this.geminiAPI.endSpeechActivity();
          console.log(`   ✅ Speech activity ended (${this.bytesSent} bytes sent via streaming)`);
        } else {
          console.log(`   ⚠️ Not ending speech activity - insufficient audio (${this.bytesSent} bytes < ${MIN_BYTES_TO_CLOSE} bytes)`);
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
      console.log(`⚠️ [Gemini VAD] Forcing speech stop after 30 seconds`);
      this.speaking = false;
      this.stats.speaking = false;
      this.voicedFrames = 0;
      this.silentFrames = 0;
      this.geminiAPI.endSpeechActivity();
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

  flushAudio(): void {
    this.geminiAPI.flushAudio();
  }

  // Gemini-specific methods
  sendTextMessage(text: string): void {
    this.geminiAPI.sendTextMessage(text);
  }

  getGeminiStats() {
    return this.geminiAPI.getStats();
  }

  // Silence detection for when no audio events are received
  private startSilenceDetection(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    this.silenceCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastAudio = now - this.lastAudioTime;

      // Simple silence timeout fallback for Gemini
      if (
        this.speaking &&
        this.isRunning &&
        timeSinceLastAudio >= this.config.vadConfig.releaseMs
      ) {
        this.speaking = false;
        this.stats.speaking = false;
        
        // End speech activity
        const MIN_BYTES_TO_CLOSE = 4800;
        if (this.bytesSent >= MIN_BYTES_TO_CLOSE) {
          this.geminiAPI.endSpeechActivity();
        }
        
        // Reset counters
        this.voicedFrames = 0;
        this.silentFrames = 0;
        this.bytesSent = 0;
        this.stats.bytesSent = 0;
        
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