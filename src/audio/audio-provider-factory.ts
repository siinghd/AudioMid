/**
 * Audio Provider Factory
 * Creates the appropriate audio provider based on configuration
 */

import { BaseAudioProvider, AudioProviderConfig } from './audio-provider-interface';
import { OpenAIAudioProvider } from './providers/openai-provider';
import { GeminiAudioProvider } from './providers/gemini-provider';

export type ProviderType = 'openai' | 'gemini';

export interface ProviderFactoryConfig {
  provider: ProviderType;
  apiKey: string;
  systemPrompt?: string;
  vadSettings: {
    enableVAD: boolean;
    threshold: number;
    holdMs: number;
    releaseMs: number;
    adaptiveNoiseFloor?: boolean;
  };
  audioSettings: {
    bufferSizeMs: number;
    enableVAD: boolean;
  };
  providerSpecific?: Record<string, any>;
}

export class AudioProviderFactory {
  static createProvider(config: ProviderFactoryConfig): BaseAudioProvider {
    const baseConfig: AudioProviderConfig = {
      apiKey: config.apiKey,
      systemPrompt: config.systemPrompt,
      vadConfig: {
        enabled: config.vadSettings.enableVAD,
        threshold: config.vadSettings.threshold,
        holdMs: config.vadSettings.holdMs,
        releaseMs: config.vadSettings.releaseMs,
        adaptiveNoiseFloor: config.vadSettings.adaptiveNoiseFloor,
        // Enhanced VAD settings with good defaults for system audio
        aggressiveness: 3, // More aggressive WebRTC VAD for system audio
        noiseFloorAlpha: 0.95, // Smooth noise floor tracking
        noiseFloorRatio: 2.0, // Require 2x above noise floor
        silenceTimeoutMs: 1200, // Force stop after 1.2s of no audio updates
      },
      audioSettings: config.audioSettings,
      providerSpecific: config.providerSpecific,
    };

    switch (config.provider) {
      case 'openai':
        return new OpenAIAudioProvider({
          ...baseConfig,
          providerSpecific: {
            model: 'gpt-4o-realtime-preview-2025-06-03',
            voice: 'alloy',
            wantTranscripts: true,
            wantText: true,
            transcriptionModel: 'whisper-1',
            ...config.providerSpecific,
          },
        });

      case 'gemini':
        return new GeminiAudioProvider({
          ...baseConfig,
          providerSpecific: {
            model: 'gemini-live-2.5-flash-preview',
            audioArchitecture: 'half-cascade',
            responseModalities: ['AUDIO'],
            voiceName: 'Puck',
            ...config.providerSpecific,
          },
        });

      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }

  static getProviderCapabilities(provider: ProviderType): {
    supportedSampleRates: number[];
    supportedChannels: number[];
    supportedFormats: string[];
    hasBuiltInVAD: boolean;
    requiresExternalVAD: boolean;
  } {
    switch (provider) {
      case 'openai':
        return {
          supportedSampleRates: [24000],
          supportedChannels: [1],
          supportedFormats: ['pcm16'],
          hasBuiltInVAD: false, // We disabled server VAD
          requiresExternalVAD: true, // Now requires WebRTC VAD
        };

      case 'gemini':
        return {
          supportedSampleRates: [16000],
          supportedChannels: [1],
          supportedFormats: ['pcm16'],
          hasBuiltInVAD: true,
          requiresExternalVAD: true, // We prefer external VAD for better control
        };

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  static validateConfig(config: ProviderFactoryConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.apiKey) {
      errors.push('API key is required');
    }

    if (!['openai', 'gemini'].includes(config.provider)) {
      errors.push(`Unsupported provider: ${config.provider}`);
    }

    if (config.vadSettings.threshold < 0 || config.vadSettings.threshold > 1) {
      errors.push('VAD threshold must be between 0 and 1');
    }

    if (config.vadSettings.holdMs < 0 || config.vadSettings.holdMs > 5000) {
      errors.push('VAD hold time must be between 0 and 5000ms');
    }

    if (config.vadSettings.releaseMs < 0 || config.vadSettings.releaseMs > 10000) {
      errors.push('VAD release time must be between 0 and 10000ms');
    }

    if (config.audioSettings.bufferSizeMs < 100 || config.audioSettings.bufferSizeMs > 5000) {
      errors.push('Buffer size must be between 100 and 5000ms');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}