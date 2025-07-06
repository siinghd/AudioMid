/**
 * Unified audio provider interface
 * Allows different AI providers to use the same audio processing system
 * with provider-specific customizations
 */

import { EventEmitter } from 'events';

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  bytesPerFrame: number;
}

export interface VADConfig {
  enabled: boolean;
  threshold: number;
  holdMs: number;
  releaseMs: number;
  adaptiveNoiseFloor?: boolean;
  aggressiveness?: 0 | 1 | 2 | 3; // WebRTC VAD aggressiveness (3 = most aggressive)
  noiseFloorAlpha?: number; // Smoothing factor for noise floor (0.9-0.99)
  noiseFloorRatio?: number; // Multiplier above noise floor to detect speech (1.5-3.0)
  silenceTimeoutMs?: number; // Force stop after this many ms of no audio updates
  turnManagementMode?: 'internal-vad' | 'external-timeout'; // Choose turn management approach
}

export interface AudioProviderConfig {
  apiKey: string;
  systemPrompt?: string;
  vadConfig: VADConfig;
  audioSettings: {
    bufferSizeMs: number;
    enableVAD: boolean;
  };
  providerSpecific?: Record<string, any>;
}

export interface AudioStats {
  audioChunksProcessed: number;
  userTranscriptsReceived: number;
  aiResponsesReceived: number;
  lastActivity: number | null;
  isConnected: boolean;
  isProcessing: boolean;
  speaking: boolean;
  bytesSent: number;
}

/**
 * Base interface that all audio providers must implement
 */
export abstract class BaseAudioProvider extends EventEmitter {
  protected config: AudioProviderConfig;
  protected isInitialized = false;
  protected isRunning = false;
  protected stats: AudioStats;
  protected audioCapture: any = null;

  // VAD state
  protected speaking = false;
  protected voicedFrames = 0;
  protected silentFrames = 0;
  protected bytesSent = 0;
  
  // Adaptive noise floor tracking  
  protected noiseFloor = 0.02; // Start with reasonable baseline
  protected lastAudioTime = 0;
  protected silenceCheckInterval: NodeJS.Timeout | null = null;

  // VAD constants
  protected readonly VAD_FRAME_MS = 20;
  protected readonly VAD_SAMPLES_PER_FRAME = 960; // 48000 * 20 / 1000

  constructor(config: AudioProviderConfig) {
    super();
    this.config = config;
    this.stats = {
      audioChunksProcessed: 0,
      userTranscriptsReceived: 0,
      aiResponsesReceived: 0,
      lastActivity: null,
      isConnected: false,
      isProcessing: false,
      speaking: false,
      bytesSent: 0,
    };
  }

  // Abstract methods that providers must implement
  abstract initialize(): Promise<void>;
  abstract start(): void;
  abstract stop(): void;
  abstract disconnect(): void;
  abstract isReady(): boolean;
  abstract updateSystemPrompt(prompt: string): void;
  abstract getCurrentTranscript(): string;

  // Provider-specific audio processing
  protected abstract processProviderAudio(audioData: Float32Array): void;
  protected abstract getTargetAudioFormat(): { sampleRate: number; channels: number; bitsPerSample: number };

  // Common VAD processing that all providers can use
  processAudioChunk(audioData: Float32Array): boolean {
    if (!this.isRunning || !this.isReady()) {
      return false;
    }

    try {
      this.stats.audioChunksProcessed++;
      this.stats.isProcessing = true;
      this.lastAudioTime = Date.now(); // Update for silence timeout

      // Process WebRTC VAD if available
      const speech = this.processWebRTCVAD(audioData);
      
      // Update VAD state machine
      this.updateVADState(speech);

      // Only process audio during speech if VAD is enabled
      if (!this.config.vadConfig.enabled || this.speaking) {
        this.processProviderAudio(audioData);
      }

      this.stats.isProcessing = false;
      return true;
    } catch (error) {
      console.error('❌ Audio processing error:', error);
      this.stats.isProcessing = false;
      this.emit('audio.error', error);
      return false;
    }
  }

  // Silence timeout fail-safe mechanism
  protected startSilenceTimeout(): void {
    const timeoutMs = this.config.vadConfig.silenceTimeoutMs || 1200;
    
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    this.silenceCheckInterval = setInterval(() => {
      if (this.speaking && this.isRunning) {
        const timeSinceLastAudio = Date.now() - this.lastAudioTime;
        
        if (timeSinceLastAudio >= timeoutMs) {
          console.log(`🛑 [${this.constructor.name} Silence Timeout] No audio for ${timeSinceLastAudio}ms - forcing stop`);
          this.speaking = false;
          this.stats.speaking = false;
          this.voicedFrames = 0;
          this.silentFrames = 0;
          this.onSpeechStopped();
          this.emit('user.speech_stopped');
        }
      }
    }, 50);
  }

  protected stopSilenceTimeout(): void {
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
  }

  // Enhanced WebRTC VAD with adaptive noise floor and improved discrimination
  protected processWebRTCVAD(audioData: Float32Array): boolean {
    if (!this.config.vadConfig.enabled || !this.audioCapture?.isVADInitialized()) {
      return true; // If VAD disabled, always consider as speech
    }

    try {
      // Convert float32 to int16 for WebRTC VAD
      const pcm48Data = this.float32ToPcm16(audioData);

      let framesProcessed = 0;
      let speechFrames = 0;
      let totalRMS = 0;

      // Process in 20ms frames (960 samples at 48kHz)
      for (
        let offset = 0;
        offset + this.VAD_SAMPLES_PER_FRAME <= pcm48Data.length;
        offset += this.VAD_SAMPLES_PER_FRAME
      ) {
        const frameBuffer = Buffer.from(
          pcm48Data.buffer,
          pcm48Data.byteOffset + offset * 2,
          this.VAD_SAMPLES_PER_FRAME * 2
        );

        // Get WebRTC VAD result for this frame
        const frameHasWebRTCSpeech = this.audioCapture.processVAD(frameBuffer);
        
        // Calculate RMS energy for this frame
        const frameStart = Math.floor((offset / 2) * (audioData.length / pcm48Data.length));
        const frameEnd = Math.min(frameStart + this.VAD_SAMPLES_PER_FRAME, audioData.length);
        const frameFloat = audioData.slice(frameStart, frameEnd);
        
        let frameRMS = 0;
        for (let i = 0; i < frameFloat.length; i++) {
          frameRMS += frameFloat[i] * frameFloat[i];
        }
        frameRMS = Math.sqrt(frameRMS / frameFloat.length);
        totalRMS += frameRMS;
        framesProcessed += 1;

        // Enhanced speech detection: WebRTC VAD + adaptive noise floor
        const isAboveNoiseFloor = this.isAboveNoiseFloor(frameRMS);
        const frameSpeech = frameHasWebRTCSpeech && isAboveNoiseFloor;
        
        if (frameSpeech) {
          speechFrames += 1;
        }

        // Update noise floor when no speech detected OR during very quiet periods
        if (!frameHasWebRTCSpeech || frameRMS < this.noiseFloor * 1.2) {
          this.updateNoiseFloor(frameRMS);
        }
      }

      const avgRMS = totalRMS / framesProcessed;
      
      // Require significant percentage of frames to have speech (anti-burst logic)
      const speechPercentage = speechFrames / framesProcessed;
      const minSpeechPercentage = 0.4; // Require 40% of frames to have speech
      const hasSpeech = speechPercentage >= minSpeechPercentage;

      // ALWAYS log VAD analysis for debugging audio points
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      // Detailed VAD logging removed for performance

      return hasSpeech;
    } catch (error) {
      console.warn(`${this.constructor.name} WebRTC VAD error, using fallback:`, error);
      return this.fallbackVAD(audioData);
    }
  }

  // Adaptive noise floor management
  private updateNoiseFloor(rms: number): void {
    const alpha = this.config.vadConfig.noiseFloorAlpha || 0.95;
    this.noiseFloor = alpha * this.noiseFloor + (1 - alpha) * rms;
  }

  private isAboveNoiseFloor(rms: number): boolean {
    if (!this.config.vadConfig.adaptiveNoiseFloor) {
      return rms > (this.config.vadConfig.threshold || 0.02);
    }
    
    const ratio = this.config.vadConfig.noiseFloorRatio || 2.0;
    return rms > this.noiseFloor * ratio;
  }

  // Common VAD state machine
  protected updateVADState(speech: boolean): void {
    // ALWAYS log VAD state changes for debugging
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    // VAD state logging removed for performance

    if (speech) {
      this.voicedFrames += 1;
      this.silentFrames = 0;

      // Start speaking after HOLD_MS of continuous voice
      if (!this.speaking && this.voicedFrames * this.VAD_FRAME_MS >= this.config.vadConfig.holdMs) {
        this.speaking = true;
        this.stats.speaking = true;
        this.onSpeechStarted();
        this.emit('user.speech_started');
      }
    } else {
      this.silentFrames += 1;
      this.voicedFrames = 0; // Reset voiced frames during silence

      // Stop speaking after RELEASE_MS of continuous silence
      if (this.speaking && this.silentFrames * this.VAD_FRAME_MS >= this.config.vadConfig.releaseMs) {
        this.speaking = false;
        this.stats.speaking = false;
        this.voicedFrames = 0;
        this.silentFrames = 0;
        this.onSpeechStopped();
        this.emit('user.speech_stopped');
      }
    }

    // Fallback: if we've been "speaking" for more than 30 seconds, force stop
    if (this.speaking && this.voicedFrames * this.VAD_FRAME_MS > 30000) {
      this.speaking = false;
      this.stats.speaking = false;
      this.voicedFrames = 0;
      this.silentFrames = 0;
      this.onSpeechStopped();
      this.emit('user.speech_stopped');
    }
  }

  // Hooks for providers to override
  protected onSpeechStarted(): void {
    // Override in provider implementation
  }

  protected onSpeechStopped(): void {
    // Override in provider implementation
  }

  // Fallback VAD using RMS
  protected fallbackVAD(audioData: Float32Array): boolean {
    let rms = 0;
    for (let i = 0; i < audioData.length; i++) {
      rms += audioData[i] * audioData[i];
    }
    rms = Math.sqrt(rms / audioData.length);
    return rms > this.config.vadConfig.threshold;
  }

  // Common audio utilities
  protected float32ToPcm16(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
    }
    return output;
  }

  protected downsampleAudio(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    const ratio = fromRate / toRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      output[i] = input[Math.floor(i * ratio)];
    }
    
    return output;
  }

  protected stereoToMono(src: Float32Array): Float32Array {
    const dst = new Float32Array(src.length / 2);
    const k = 0.70710677;           // 1/√2 for equal power conversion
    for (let i = 0, j = 0; i < dst.length; i++, j += 2) {
      dst[i] = (src[j] + src[j + 1]) * k;
    }
    return dst;
  }

  // Common interface methods
  setAudioCapture(audioCapture: any): void {
    this.audioCapture = audioCapture;
    // Audio capture reference set
  }

  setVADConfig(enabled: boolean, threshold: number): void {
    this.config.vadConfig.enabled = enabled;
    this.config.vadConfig.threshold = threshold;
    // VAD config updated
  }

  getStats(): AudioStats {
    return { ...this.stats };
  }

  clearTranscriptHistory(): void {
    // Transcript history cleared
  }

  flushAudio(): void {
    // Override in provider implementation if needed
  }

  setDebugSettings(settings: { dumpRawAudio?: boolean; dumpApiAudio?: boolean }): void {
    // Override in provider implementation if needed
  }
}