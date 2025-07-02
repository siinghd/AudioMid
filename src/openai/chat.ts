/**
 * OpenAI Chat Completion API helper
 * Processes transcriptions through GPT-4o for intelligent responses
 */

import OpenAI from 'openai';
import { EventEmitter } from 'events';

interface ChatConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface ChatResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
  timestamp: number;
}

export default class ChatCompletionHelper extends EventEmitter {
  private openai: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;
  private temperature: number;
  private conversationHistory: ChatMessage[] = [];
  private isProcessing = false;

  constructor({
    apiKey,
    model = 'gpt-4o',
    systemPrompt = 'You are a helpful AI assistant. Respond naturally and concisely to what the user is saying.',
    maxTokens = 500,
    temperature = 0.7,
  }: ChatConfig) {
    super();
    
    this.openai = new OpenAI({ apiKey });
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.maxTokens = maxTokens;
    this.temperature = temperature;

    // Initialize conversation with system prompt
    this.conversationHistory.push({
      role: 'system',
      content: this.systemPrompt,
      timestamp: Date.now(),
    });
  }

  async processTranscript(transcript: string): Promise<ChatResponse | null> {
    if (!transcript.trim()) {
      console.warn('⚠️ Empty transcript provided');
      return null;
    }

    if (this.isProcessing) {
      console.warn('⚠️ Already processing a request, skipping');
      return null;
    }

    this.isProcessing = true;

    try {
      console.log('🧠 Processing transcript:', transcript);

      // Add user message to conversation history
      const userMessage: ChatMessage = {
        role: 'user',
        content: transcript,
        timestamp: Date.now(),
      };
      this.conversationHistory.push(userMessage);

      // Prepare messages for API call (last 10 messages to manage context)
      const messages = this.conversationHistory
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

      console.log('📤 Sending to OpenAI:', {
        model: this.model,
        messageCount: messages.length,
        lastMessage: messages[messages.length - 1],
      });

      // Call OpenAI Chat Completion API
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: false, // For now, use non-streaming
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        console.error('❌ No response from OpenAI');
        return null;
      }

      console.log('📥 Received response:', response);

      // Add assistant response to conversation history
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };
      this.conversationHistory.push(assistantMessage);

      const chatResponse: ChatResponse = {
        content: response,
        usage: completion.usage ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        } : undefined,
        model: completion.model,
        timestamp: Date.now(),
      };

      // Emit response event for real-time updates
      this.emit('response', chatResponse);

      return chatResponse;

    } catch (error) {
      console.error('❌ Chat completion error:', error);
      this.emit('error', error);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  // Stream version for real-time response chunks
  async streamTranscript(transcript: string): Promise<void> {
    if (!transcript.trim()) {
      console.warn('⚠️ Empty transcript provided');
      return;
    }

    if (this.isProcessing) {
      console.warn('⚠️ Already processing a request, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      console.log('🧠 Streaming transcript:', transcript);

      // Add user message to conversation history
      const userMessage: ChatMessage = {
        role: 'user',
        content: transcript,
        timestamp: Date.now(),
      };
      this.conversationHistory.push(userMessage);

      // Prepare messages for API call
      const messages = this.conversationHistory
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

      console.log('📤 Streaming to OpenAI...');

      // Call OpenAI Chat Completion API with streaming
      const stream = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        stream: true,
      });

      let fullContent = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          // Emit streaming chunk
          this.emit('chunk', delta);
        }
      }

      console.log('📥 Stream completed:', fullContent);

      // Add complete assistant response to conversation history
      if (fullContent) {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullContent,
          timestamp: Date.now(),
        };
        this.conversationHistory.push(assistantMessage);

        // Emit final response
        this.emit('response', {
          content: fullContent,
          model: this.model,
          timestamp: Date.now(),
        });
      }

    } catch (error) {
      console.error('❌ Chat streaming error:', error);
      this.emit('error', error);
    } finally {
      this.isProcessing = false;
    }
  }

  getConversationHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  clearHistory(): void {
    this.conversationHistory = [{
      role: 'system',
      content: this.systemPrompt,
      timestamp: Date.now(),
    }];
    console.log('🗑️ Conversation history cleared');
  }

  updateSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
    this.conversationHistory[0] = {
      role: 'system',
      content: prompt,
      timestamp: Date.now(),
    };
    console.log('📝 System prompt updated');
  }

  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  getStats(): {
    messageCount: number;
    lastActivity: number | null;
  } {
    return {
      messageCount: this.conversationHistory.length - 1, // Exclude system prompt
      lastActivity: this.conversationHistory.length > 1 
        ? this.conversationHistory[this.conversationHistory.length - 1].timestamp || null
        : null,
    };
  }
}