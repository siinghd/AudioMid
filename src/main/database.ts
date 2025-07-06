import Database from 'better-sqlite3';
import crypto from 'crypto';
import { app } from 'electron';
import path from 'path';
import { DEFAULT_SYSTEM_PROMPT } from '../common/defaultPrompt';

export interface AppSettings {
  id?: number;
  openaiApiKey?: string;
  geminiApiKey?: string;
  aiProvider: 'openai' | 'gemini';
  systemPrompt?: string;
  windowOpacity: number;
  alwaysOnTop: boolean;
  invisibleToRecording: boolean;
  windowWidth: number;
  windowHeight: number;
  windowX?: number;
  windowY?: number;
  theme: 'dark' | 'light';
  autoStart: boolean;
  showInTray: boolean;
  vadSettings?: {
    releaseMs: number;
    holdMs: number;
    threshold: number;
    adaptiveNoiseFloor: boolean;
  };
  audioSettings?: {
    bufferSizeMs: number;
    enableVAD: boolean;
  };
  geminiSettings?: {
    model:
      | 'gemini-2.5-flash-preview-native-audio-dialog'
      | 'gemini-live-2.5-flash-preview'
      | 'gemini-2.0-flash-live-001';
    audioArchitecture: 'native' | 'half-cascade';
    responseModalities: string[];
  };
  debugSettings?: {
    dumpNativeAudio: boolean;
    dumpOpenAIRawAudio: boolean;
    dumpOpenAIApiAudio: boolean;
  };
  transcriptSettings?: {
    enabled: boolean;
  };
  lastUpdated: string;
}

export interface ConversationRecord {
  id?: number;
  timestamp: string;
  userInput?: string;
  aiResponse: string;
  audioMetadata?: string;
  duration?: number;
}

class DatabaseManager {
  private db: Database.Database;
  private encryptionKey: string;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'ai-audio-assistant.db');
    this.db = new Database(dbPath);
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.initializeTables();
  }

  private getOrCreateEncryptionKey(): string {
    const keyPath = path.join(app.getPath('userData'), '.app-key');
    const fs = require('fs');

    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8');
    } else {
      const key = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyPath, key, { mode: 0o600 }); // Secure file permissions
      return key;
    }
  }

  private encrypt(text: string): string {
    try {
      // Generate a random IV for each encryption
      const iv = crypto.randomBytes(16);
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Prepend IV to encrypted data
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      console.error('Encryption failed:', error);
      return text; // Return original text if encryption fails
    }
  }

  private decrypt(encryptedText: string): string {
    try {
      // Split IV and encrypted data
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error);
      return '';
    }
  }

  private initializeTables(): void {
    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openaiApiKey TEXT,
        systemPrompt TEXT,
        windowOpacity REAL DEFAULT 1.0,
        alwaysOnTop BOOLEAN DEFAULT 1,
        invisibleToRecording BOOLEAN DEFAULT 1,
        windowWidth INTEGER DEFAULT 800,
        windowHeight INTEGER DEFAULT 600,
        windowX INTEGER,
        windowY INTEGER,
        theme TEXT DEFAULT 'dark',
        autoStart BOOLEAN DEFAULT 0,
        showInTray BOOLEAN DEFAULT 1,
        lastUpdated TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add systemPrompt column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN systemPrompt TEXT`);
      console.log('✅ Added systemPrompt column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 systemPrompt column already exists in settings table');
    }

    // Migration: Add VAD settings column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN vadSettings TEXT`);
      console.log('✅ Added vadSettings column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 vadSettings column already exists in settings table');
    }

    // Migration: Add audio settings column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN audioSettings TEXT`);
      console.log('✅ Added audioSettings column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 audioSettings column already exists in settings table');
    }

    // Migration: Add Gemini API key column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN geminiApiKey TEXT`);
      console.log('✅ Added geminiApiKey column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 geminiApiKey column already exists in settings table');
    }

    // Migration: Add AI provider column if it doesn't exist
    try {
      this.db.exec(
        `ALTER TABLE settings ADD COLUMN aiProvider TEXT DEFAULT 'openai'`,
      );
      console.log('✅ Added aiProvider column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 aiProvider column already exists in settings table');
    }

    // Migration: Add Gemini settings column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN geminiSettings TEXT`);
      console.log('✅ Added geminiSettings column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 geminiSettings column already exists in settings table');
    }

    // Migration: Add debug settings column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN debugSettings TEXT`);
      console.log('✅ Added debugSettings column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log('📝 debugSettings column already exists in settings table');
    }

    // Migration: Add transcript settings column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN transcriptSettings TEXT`);
      console.log('✅ Added transcriptSettings column to settings table');
    } catch {
      // Column already exists, which is fine
      console.log(
        '📝 transcriptSettings column already exists in settings table',
      );
    }

    // Conversations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        userInput TEXT,
        aiResponse TEXT NOT NULL,
        audioMetadata TEXT,
        duration INTEGER
      )
    `);

    // Create default settings if none exist
    const existingSettings = this.getSettings();
    if (!existingSettings) {
      this.saveSettings({
        windowOpacity: 1.0,
        alwaysOnTop: true,
        invisibleToRecording: true,
        windowWidth: 800,
        windowHeight: 600,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        theme: 'dark',
        autoStart: false,
        showInTray: true,
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  public getSettings(): AppSettings | null {
    const stmt = this.db.prepare(
      'SELECT * FROM settings ORDER BY id DESC LIMIT 1',
    );
    const row = stmt.get() as any;

    if (!row) return null;

    return {
      ...row,
      systemPrompt: row.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      openaiApiKey: row.openaiApiKey
        ? this.decrypt(row.openaiApiKey)
        : undefined,
      geminiApiKey: row.geminiApiKey
        ? this.decrypt(row.geminiApiKey)
        : undefined,
      aiProvider: row.aiProvider || 'openai',
      alwaysOnTop: Boolean(row.alwaysOnTop),
      invisibleToRecording: Boolean(row.invisibleToRecording),
      autoStart: Boolean(row.autoStart),
      showInTray: Boolean(row.showInTray),
      vadSettings: row.vadSettings
        ? JSON.parse(row.vadSettings)
        : {
            releaseMs: 2000,
            holdMs: 200,
            threshold: 0.02,
            adaptiveNoiseFloor: true,
          },
      audioSettings: row.audioSettings
        ? JSON.parse(row.audioSettings)
        : {
            bufferSizeMs: 1000,
            enableVAD: true,
          },
      geminiSettings: row.geminiSettings
        ? JSON.parse(row.geminiSettings)
        : {
            model: 'gemini-2.5-flash-preview-native-audio-dialog',
            audioArchitecture: 'native',
            responseModalities: ['AUDIO'],
          },
      debugSettings: row.debugSettings
        ? JSON.parse(row.debugSettings)
        : {
            dumpNativeAudio: false,
            dumpOpenAIRawAudio: false,
            dumpOpenAIApiAudio: false,
          },
      transcriptSettings: row.transcriptSettings
        ? JSON.parse(row.transcriptSettings)
        : {
            enabled: false,
          },
    };
  }

  public saveSettings(settings: Partial<AppSettings>): void {
    const currentSettings = this.getSettings() || ({} as AppSettings);
    const updatedSettings = {
      ...currentSettings,
      ...settings,
      lastUpdated: new Date().toISOString(),
    };

    // Encrypt API keys if provided
    const openaiApiKeyToStore = updatedSettings.openaiApiKey
      ? this.encrypt(updatedSettings.openaiApiKey)
      : null;
    const geminiApiKeyToStore = updatedSettings.geminiApiKey
      ? this.encrypt(updatedSettings.geminiApiKey)
      : null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settings (
        id, openaiApiKey, geminiApiKey, aiProvider, systemPrompt, windowOpacity, alwaysOnTop, invisibleToRecording,
        windowWidth, windowHeight, windowX, windowY, theme, autoStart, showInTray, vadSettings, audioSettings, geminiSettings, debugSettings, transcriptSettings, lastUpdated
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      openaiApiKeyToStore,
      geminiApiKeyToStore,
      updatedSettings.aiProvider || 'openai',
      updatedSettings.systemPrompt,
      updatedSettings.windowOpacity,
      updatedSettings.alwaysOnTop ? 1 : 0,
      updatedSettings.invisibleToRecording ? 1 : 0,
      updatedSettings.windowWidth,
      updatedSettings.windowHeight,
      updatedSettings.windowX,
      updatedSettings.windowY,
      updatedSettings.theme,
      updatedSettings.autoStart ? 1 : 0,
      updatedSettings.showInTray ? 1 : 0,
      updatedSettings.vadSettings
        ? JSON.stringify(updatedSettings.vadSettings)
        : null,
      updatedSettings.audioSettings
        ? JSON.stringify(updatedSettings.audioSettings)
        : null,
      updatedSettings.geminiSettings
        ? JSON.stringify(updatedSettings.geminiSettings)
        : null,
      updatedSettings.debugSettings
        ? JSON.stringify(updatedSettings.debugSettings)
        : null,
      updatedSettings.transcriptSettings
        ? JSON.stringify(updatedSettings.transcriptSettings)
        : null,
      updatedSettings.lastUpdated,
    );
  }

  public saveConversation(
    conversation: Omit<ConversationRecord, 'id'>,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (timestamp, userInput, aiResponse, audioMetadata, duration)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      conversation.timestamp,
      conversation.userInput,
      conversation.aiResponse,
      conversation.audioMetadata,
      conversation.duration,
    );

    return result.lastInsertRowid as number;
  }

  public getConversations(
    limit: number = 50,
    offset: number = 0,
  ): ConversationRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations 
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `);

    return stmt.all(limit, offset) as ConversationRecord[];
  }

  public searchConversations(
    query: string,
    limit: number = 20,
  ): ConversationRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE aiResponse LIKE ? OR userInput LIKE ?
      ORDER BY timestamp DESC 
      LIMIT ?
    `);

    const searchQuery = `%${query}%`;
    return stmt.all(searchQuery, searchQuery, limit) as ConversationRecord[];
  }

  public clearConversations(): void {
    this.db.exec('DELETE FROM conversations');
  }

  public close(): void {
    this.db.close();
  }
}

export default DatabaseManager;
