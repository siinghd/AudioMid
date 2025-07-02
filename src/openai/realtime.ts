/**
 * OpenAI Realtime API WebSocket client for Speech-to-Speech conversations
 * Streams audio to GPT-4o and receives both audio responses and text transcriptions
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

interface TurnDetectionConfig {
  type: 'server_vad' | 'semantic_vad';
  threshold?: number;        // server_vad only
  prefix_padding_ms?: number; // server_vad only
  silence_duration_ms?: number; // server_vad only
  eagerness?: 'low' | 'medium' | 'high' | 'auto'; // semantic_vad only
  interrupt_response?: boolean; // semantic_vad only
  create_response?: boolean;
}

interface RealtimeConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  voice?: string;
  turnDetection?: TurnDetectionConfig;
  wantText?: boolean;
  wantTranscripts?: boolean;
  transcriptionModel?: 'gpt-4o-transcribe' | 'whisper-1';
}

interface OpenAIMessage {
  type?: string;
  text?: string;
  transcript?: string;
  delta?: string;
  is_final?: boolean;
  item_id?: string;
  event_id?: string;
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
    event_id?: string;
  };
}

export default class RealtimeConversation extends EventEmitter {
  private apiKey: string;
  private model: string;
  private config: RealtimeConfig;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private sessionStartTime = 0;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly SESSION_REFRESH_MS = 25 * 60 * 1000; // 25 minutes
  
  // Event tracking for better error diagnostics
  private pendingEvents = new Map<string, any>();
  private lastChunkBytes = 0;

  constructor(config: RealtimeConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-realtime-preview-2025-06-03';
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🔌 Connecting to OpenAI Realtime API...');

      this.ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${this.model}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.once('open', () => {
        console.log('✅ Connected to OpenAI Realtime API');
        this.isConnected = true;
        this.sessionStartTime = Date.now();
        this.reconnectAttempts = 0; // Reset on successful connection
        this.initSession();
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as OpenAIMessage;
          console.log(`📨 [Realtime WS] Received: ${message.type}`);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(`🔌 WebSocket closed: ${code} - ${reason.toString()}`);
        this.isConnected = false;
        this.emit('closed', code, reason.toString());
      });

      this.ws.on('error', (error: Error) => {
        console.error('❌ WebSocket error:', error);
        this.isConnected = false;
        this.emit('error', error);
        
        // Attempt reconnection after error
        this.scheduleReconnect();
        reject(error);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  private initSession(): void {
    if (!this.ws || !this.isConnected) return;

    // Build session configuration with CLIENT-DRIVEN turn detection
    const session: any = {
      modalities: ['audio', 'text'], // Always enable both for best experience
      voice: this.config.voice || 'alloy',
      instructions: this.config.systemPrompt || 'You are a helpful AI assistant. Please respond naturally and concisely to what you hear.',
      
      input_audio_format: 'pcm16',
      
      output_audio_format: 'pcm16'
    };

    // Add transcription if requested (optional - may fail without affecting conversation)
    if (this.config.wantTranscripts !== false) {
      session.input_audio_transcription = { 
        model: this.config.transcriptionModel || 'gpt-4o-transcribe' 
      };
      // Note: Transcription failures are non-critical and won't stop the conversation
    }

    const sessionConfig = {
      type: 'session.update',
      session
    };

    console.log('🔧 Initializing Realtime API session (CLIENT-DRIVEN VAD):', {
      modalities: session.modalities,
      voice: session.voice,
      audio_format: session.input_audio_format,
      transcription: !!session.input_audio_transcription
    });
    
    console.log('📤 [Session Update] Sending config:', JSON.stringify(sessionConfig, null, 2));
    this.ws.send(JSON.stringify(sessionConfig));
  }

  private handleMessage(message: OpenAIMessage): void {
    switch (message.type) {
      case 'session.created':
        console.log('✅ Realtime session created');
        console.log('   📋 Session details:', JSON.stringify(message, null, 2));
        this.emit('session.created');
        break;

      case 'session.updated':
        console.log('✅ Session updated');
        console.log('   📋 Updated config:', JSON.stringify(message, null, 2));
        break;

      // Input transcription events (what user said)
      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          console.log('📝 User said:', message.transcript);
          this.emit('user_transcript', message.transcript);
        }
        break;

      case 'conversation.item.input_audio_transcription.failed':
        console.warn(`⚠️ Transcription failed for item ${message.item_id || 'unknown'}. Size: ${this.lastChunkBytes}B, SR: 24kHz`);
        console.warn('   → Transcription is optional, continuing without text for this turn');
        // Note: To retry with Whisper-1, would need to reconnect with new session
        this.emit('transcription.failed', message.error);
        break;

      // AI response events (text)
      case 'response.text.delta':
        if (message.delta) {
          this.emit('ai_text_delta', message.delta);
        }
        break;

      case 'response.text.done':
        console.log('🤖 AI text response completed');
        this.emit('ai_text_done');
        break;

      // AI response events (audio)
      case 'response.audio.delta':
        if (message.delta) {
          console.log('🔊 AI audio delta received');
          // Convert base64 to audio buffer
          const audioBuffer = Buffer.from(message.delta, 'base64');
          this.emit('ai_audio_delta', audioBuffer);
        }
        break;

      case 'response.audio.done':
        console.log('🔊 AI audio response completed');
        this.emit('ai_audio_done');
        break;

      // Turn detection events
      case 'input_audio_buffer.speech_started':
        console.log('🎤 [VAD] User started speaking');
        console.log('   ⏰ Timestamp:', new Date().toISOString());
        console.log('   📊 Event details:', JSON.stringify(message, null, 2));
        this.emit('speech_started');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('🎤 [VAD] User stopped speaking');
        console.log('   ⏰ Timestamp:', new Date().toISOString());
        console.log('   📊 Event details:', JSON.stringify(message, null, 2));
        this.emit('speech_stopped');
        break;
        
      case 'input_audio_buffer.committed':
        console.log('✅ [Turn] Audio buffer committed - turn complete');
        console.log('   📊 Details:', JSON.stringify(message, null, 2));
        this.emit('turn.committed');
        break;
        
      case 'input_audio_buffer.cleared':
        console.log('🗑️ [Turn] Audio buffer cleared - ready for next turn');
        break;
        
      case 'conversation.item.created':
        console.log('📝 [Turn] Conversation item created');
        console.log('   📊 Details:', JSON.stringify(message, null, 2));
        break;
        
      case 'response.output_item.added':
        console.log('🤖 [Response] Output item added');
        break;
        
      case 'response.content_part.added':
        console.log('🤖 [Response] Content part added');
        break;

      // Response events
      case 'response.created':
        console.log('🤖 AI response started');
        this.emit('response_started');
        break;

      case 'response.done':
        console.log('🤖 AI response fully completed');
        this.emit('response_completed');
        break;

      case 'error': {
        const { type, code, message: errorMsg, param, event_id: eventId } = message.error || {};
        console.error('[Realtime-Error]', { type, code, param, eventId, msg: errorMsg });
        
        // Look up the originating event for context
        if (eventId) {
          const originatingEvent = this.pendingEvents.get(eventId);
          if (originatingEvent) {
            console.error('   ↳ Caused by:', originatingEvent.type, 'sent', Date.now() - originatingEvent.sentAt, 'ms ago');
            this.pendingEvents.delete(eventId);
          }
        }
        
        this.emit(
          'error',
          new Error(errorMsg || 'Unknown API error'),
        );
        break;
      }

      // Audio transcript events (what the AI is saying)
      case 'response.audio_transcript.delta':
        if (message.delta) {
          this.emit('ai_audio_transcript_delta', message.delta);
        }
        break;
        
      case 'response.audio_transcript.done':
        if (message.transcript) {
          console.log('🤖 AI said (audio):', message.transcript);
          this.emit('ai_audio_transcript_done', message.transcript);
        }
        break;
        
      case 'response.content_part.done':
      case 'response.output_item.done':
      case 'rate_limits.updated':
        // These are informational events we can safely ignore
        break;

      default:
        console.log('🔍 Unhandled message type:', message.type);
        console.log('   📊 Full message:', JSON.stringify(message, null, 2));
        break;
    }
  }

  private audioChunksSent = 0;
  private lastAudioLogTime = 0;

  pushPCM(int16Array: Int16Array): boolean {
    if (!this.ws || !this.isConnected) {
      console.warn('⚠️ Cannot send audio: not connected');
      return false;
    }

    try {
      const buffer = Buffer.from(
        int16Array.buffer,
        int16Array.byteOffset,
        int16Array.byteLength,
      );
      const base64Audio = buffer.toString('base64');

      const audioMessage = {
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      };

      const success = this.send(audioMessage);
      
      if (success) {
        this.audioChunksSent += 1;
        this.lastChunkBytes = int16Array.byteLength; // Track for error diagnostics
        
        // Log every 100 chunks (approximately every 4 seconds at 40ms chunks)
        const now = Date.now();
        if (this.audioChunksSent % 100 === 0 || now - this.lastAudioLogTime > 5000) {
          console.log(`📤 [Audio] Sent chunk #${this.audioChunksSent} (${int16Array.length} samples, ${int16Array.byteLength} bytes)`);
          this.lastAudioLogTime = now;
        }
      }
      
      return success;
    } catch (error) {
      console.error('❌ Error sending audio:', error);
      return false;
    }
  }

  // Helper method to send any message with automatic event ID tracking
  send(message: any): boolean {
    if (!this.ws || !this.isConnected) {
      console.warn('⚠️ Cannot send message: not connected');
      return false;
    }

    // Check WebSocket buffer to avoid overflow
    if (this.ws.bufferedAmount > 128_000) {
      console.warn('⚠️ WebSocket buffer full, dropping message');
      return false;
    }

    try {
      // Add event_id for tracking if not already present
      if (!message.event_id) {
        message.event_id = crypto.randomUUID();
      }
      
      // Track important events for error diagnostics
      if (['response.create', 'input_audio_buffer.commit'].includes(message.type)) {
        this.pendingEvents.set(message.event_id, {
          type: message.type,
          sentAt: Date.now(),
          details: { ...message }
        });
      }
      
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      return false;
    }
  }

  // Note: startTurn() removed - not needed for streaming audio
  // The server automatically creates conversation items when we commit the buffer

  // Client-driven turn completion sequence
  closeTurn(): void {
    if (!this.ws || !this.isConnected) return;

    console.log('🛑 [Turn Management] Closing turn (client-driven)');
    
    // 1. Commit the input audio buffer
    this.send({ type: 'input_audio_buffer.commit' });
    console.log('   ✓ Committed audio buffer');
    
    // 2. Request a response with both modalities
    this.send({ 
      type: 'response.create',
      response: { 
        modalities: ['audio', 'text'],
        instructions: undefined // Use session instructions
      }
    });
    console.log('   ✓ Requested AI response');
    
    // 3. Clear the buffer for next turn
    this.send({ type: 'input_audio_buffer.clear' });
    console.log('   ✓ Cleared audio buffer');
  }

  finish(): void {
    if (this.ws && this.isConnected) {
      console.log('🔚 Finishing session...');
      this.ws.close();
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.isConnected = false;
      this.ws.close();
      this.ws = null;
    }
  }

  isReady(): boolean {
    return (
      this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN
    );
  }

  // Production hardening: reconnection logic
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ Max reconnection attempts reached');
      this.emit('reconnect.failed');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * (2 ** (this.reconnectAttempts - 1)), 10000); // Exponential backoff
    const jitter = Math.random() * 400 + 200; // 200-600ms jitter
    
    console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay + jitter}ms`);
    
    setTimeout(() => {
      this.reconnect();
    }, delay + jitter);
  }

  async reconnect(): Promise<void> {
    console.log('🔄 Attempting to reconnect...');
    this.disconnect();
    
    try {
      await this.connect();
      console.log('✅ Reconnection successful');
      this.emit('reconnected');
    } catch (error) {
      console.error('❌ Reconnection failed:', error);
      // scheduleReconnect will be called from error handler
    }
  }

  // Check if session needs refresh (called periodically)
  checkSessionAge(): boolean {
    if (!this.isConnected || this.sessionStartTime === 0) return false;
    
    const age = Date.now() - this.sessionStartTime;
    if (age > this.SESSION_REFRESH_MS) {
      console.log('⏰ Session approaching 30-minute limit, refreshing...');
      this.reconnect();
      return true;
    }
    return false;
  }

  // Clean up old pending events
  cleanupPendingEvents(): void {
    const now = Date.now();
    this.pendingEvents.forEach((event, eventId) => {
      if (now - event.sentAt > 60_000) { // 1 minute old
        this.pendingEvents.delete(eventId);
      }
    });
  }

  // Reconnect with different transcription model (if needed)
  async reconnectWithTranscriptionModel(model: 'gpt-4o-transcribe' | 'whisper-1'): Promise<void> {
    console.log(`🔄 Reconnecting with ${model} transcription model...`);
    this.config.transcriptionModel = model;
    await this.reconnect();
  }
}