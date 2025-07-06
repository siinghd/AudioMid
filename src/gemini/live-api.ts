/**
 * Google Gemini Live API integration
 * Provides real-time voice interactions with Gemini models
 */

import { EventEmitter } from 'events';

export interface GeminiLiveConfig {
  apiKey: string;
  model: 'gemini-2.5-flash-preview-native-audio-dialog' | 'gemini-live-2.5-flash-preview' | 'gemini-2.0-flash-live-001';
  systemInstruction?: string;
  responseModalities: string[];
  audioArchitecture: 'native' | 'half-cascade';
}

export interface GeminiMessage {
  type: string;
  data?: any;
  serverContent?: {
    turnComplete?: boolean;
  };
}

export default class GeminiLiveAPI extends EventEmitter {
  private config: GeminiLiveConfig;
  private genAI: any = null;
  private liveSession: any = null;
  private isConnected = false;
  private responseQueue: GeminiMessage[] = [];
  private GoogleGenAI: any = null;
  private Modality: any = null;
  private lastAudioTime = 0;
  private audioChunkCount = 0;

  constructor(config: GeminiLiveConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      console.log('🔗 Connecting to Gemini Live API with config:', {
        model: this.config.model,
        audioArchitecture: this.config.audioArchitecture,
        responseModalities: this.config.responseModalities
      });

      // Dynamically import the ES module
      const { GoogleGenAI, Modality } = await import('@google/genai');
      this.GoogleGenAI = GoogleGenAI;
      this.Modality = Modality;

      // Initialize the GenAI client
      this.genAI = new GoogleGenAI({
        apiKey: this.config.apiKey
      });

      // Create the Live API session configuration based on the documentation
      const liveConfig = {
        responseModalities: [Modality.TEXT], // Force TEXT responses
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Puck"
            }
          }
        },
        systemInstruction: this.config.systemInstruction || "You are a helpful AI assistant. Respond naturally and concisely to what the user is saying.",
        // Disable automatic VAD since we'll use our own WebRTC VAD
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true
          }
        },
        // Enable input transcription
        enableInputTranscription: true
      };

      // Connect to the real Live API using the official SDK
      this.liveSession = await this.genAI.live.connect({
        model: this.config.model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            console.log('🔗 Live API session opened');
            this.isConnected = true;
            this.emit('connected');
          },
          onmessage: (message: any) => {
            this.handleMessage(message);
          },
          onerror: (error: any) => {
            console.error('Live API error:', error);
            this.emit('error', error);
          },
          onclose: (event: any) => {
            console.log('Live API session closed:', event.reason);
            this.isConnected = false;
            this.emit('disconnected');
          }
        }
      });
      
      console.log('✅ Connected to Gemini Live API');
      
    } catch (error) {
      console.error('Failed to connect to Gemini Live API:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private handleMessage(message: any): void {
    // Debug: Log message types to see what we're receiving
    if (message.serverContent?.inputTranscription) {
      console.log('🎤 [Gemini] Received input transcription:', message.serverContent.inputTranscription);
    }
    
    // Handle text responses from serverContent.modelTurn.parts
    if (message.serverContent?.modelTurn?.parts) {
      // Each message contains new text chunks, not accumulated text
      // Just emit each text part directly as a chunk
      message.serverContent.modelTurn.parts.forEach((part: any) => {
        if (part.text && part.text.trim()) {
          this.emit('text_chunk', part.text);
        }
      });
    }
    
    // Handle direct text responses (fallback)
    else if (message.text) {
      if (message.text.trim()) {
        this.emit('text_chunk', message.text);
      }
    }

    // Handle audio responses
    if (message.data) {
      // Convert base64 audio to ArrayBuffer
      const audioData = Uint8Array.from(atob(message.data), c => c.charCodeAt(0));
      this.emit('audio_chunk', audioData.buffer);
    }

    // Handle server content and turn completion
    if (message.serverContent) {
      // Debug: Log all serverContent keys to see what we're getting
      const contentKeys = Object.keys(message.serverContent);
      if (contentKeys.length > 0 && !contentKeys.includes('modelTurn')) {
        console.log('🔍 [Gemini] ServerContent keys:', contentKeys);
      }
      
      if (message.serverContent.turnComplete) {
        console.log('✅ Gemini turn complete');
        this.emit('turn_complete');
      }
      
      if (message.serverContent.interrupted) {
        console.log('⚠️ Gemini interrupted');
        this.emit('interrupted');
      }

      // Handle transcriptions
      if (message.serverContent.inputTranscription) {
        console.log('🎤 [Gemini] Processing input transcription:', message.serverContent.inputTranscription);
        this.emit('input_transcription', message.serverContent.inputTranscription.text);
      }
      
      if (message.serverContent.outputTranscription) {
        this.emit('output_transcription', message.serverContent.outputTranscription.text);
      }
    }

    // Handle usage metadata
    if (message.usageMetadata) {
      this.emit('usage_metadata', message.usageMetadata);
    }
  }


  sendAudioChunk(audioData: ArrayBuffer): void {
    if (!this.isConnected || !this.liveSession) {
      return;
    }

    try {
      // Only buffer audio during active speech periods to avoid sending non-speech audio
      // Audio will be sent immediately during speech activity, not buffered beforehand
      this.audioChunkCount++;
      
      // Convert to base64 and send immediately if we're in an active speech session
      const base64Audio = Buffer.from(audioData).toString('base64');
      
      this.liveSession.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: "audio/pcm;rate=16000"
        }
      });
      
    } catch (error) {
      console.error('Failed to send audio chunk:', error);
      this.emit('error', error);
    }
  }

  startSpeechActivity(): void {
    if (!this.isConnected || !this.liveSession) {
      return;
    }

    try {
      console.log('🎙️ External VAD - Speech activity started');
      // Don't reset response text here - wait for actual response
      this.liveSession.sendRealtimeInput({ activityStart: {} });
      
      // No buffered audio to send - we only send audio during active speech periods
      
      this.lastAudioTime = Date.now(); // Reset timing
    } catch (error) {
      console.error('Failed to start speech activity:', error);
      this.emit('error', error);
    }
  }

  endSpeechActivity(): void {
    if (!this.isConnected || !this.liveSession) {
      return;
    }

    try {
      console.log('🔇 External VAD - Speech activity ended');
      this.liveSession.sendRealtimeInput({ activityEnd: {} });
      
    } catch (error) {
      console.error('Failed to end speech activity:', error);
      this.emit('error', error);
    }
  }


  sendTextMessage(text: string): void {
    if (!this.isConnected || !this.liveSession) {
      console.warn('Cannot send text: not connected to Gemini Live API');
      return;
    }

    try {
      console.log('📤 Sending text message to Gemini Live API:', text);
      
      // Send client content using the Live API
      this.liveSession.sendClientContent({
        turns: [{
          role: "user",
          parts: [{
            text: text
          }]
        }],
        turnComplete: true
      });
      
    } catch (error) {
      console.error('Failed to send text message:', error);
      this.emit('error', error);
    }
  }


  updateSystemInstruction(instruction: string): void {
    this.config.systemInstruction = instruction;
    console.log('🔧 Updated Gemini system instruction:', instruction);
  }

  setVADConfig(enabled: boolean, threshold: number): void {
    // Gemini Live API has built-in VAD, so we can configure it here
    console.log('🔧 Gemini VAD config updated:', { enabled, threshold });
  }

  isReady(): boolean {
    return this.isConnected;
  }

  flushAudio(): void {
    // No audio buffering anymore - audio is sent immediately during speech activity
    // This method is kept for interface compatibility
  }

  disconnect(): void {
    // No audio buffering to flush
    
    if (this.liveSession) {
      this.liveSession.close();
      this.liveSession = null;
    }
    
    this.isConnected = false;
    this.responseQueue = [];
    this.emit('disconnected');
    console.log('🔌 Disconnected from Gemini Live API');
  }

  // Statistics and monitoring
  getStats() {
    return {
      isConnected: this.isConnected,
      model: this.config.model,
      audioArchitecture: this.config.audioArchitecture,
      responseModalities: this.config.responseModalities,
      queueSize: this.responseQueue.length
    };
  }
}