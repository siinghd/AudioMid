/**
 * High-quality audio resampling using WebAssembly libsoxr
 * Professional quality resampling for audio pipeline
 */

import SoxrResampler, { SoxrDatatype } from 'wasm-audio-resampler';

// Global resampler instance for 48kHz -> 24kHz conversion
let resampler48to24: SoxrResampler | null = null;
let isResamplerInitialized = false;

/**
 * Initialize the high-quality resampler
 * This should be called once at application startup
 */
export async function initializeResampler(): Promise<void> {
  if (isResamplerInitialized) {
    return;
  }

  try {
    console.log('🔧 Initializing high-quality audio resampler...');
    
    // TEMPORARILY DISABLED: WASM file path issues in Electron
    // Will use simple resampling for now
    console.warn('⚠️ High-quality resampler temporarily disabled due to WASM loading issues');
    console.warn('⚠️ Using simple 2:1 decimation fallback');
    isResamplerInitialized = false;
    return;
    
    // TODO: Fix WASM loading in Electron environment
    // Create resampler for 48kHz mono Float32 -> 24kHz mono Float32
    const channels = 1; // Mono audio
    const inRate = 48000; // Input sample rate
    const outRate = 24000; // Output sample rate
    const inputDatatype = SoxrDatatype.SOXR_FLOAT32; // Float32 input
    const outputDatatype = SoxrDatatype.SOXR_FLOAT32; // Float32 output
    
    resampler48to24 = new SoxrResampler(
      channels,
      inRate,
      outRate,
      inputDatatype,
      outputDatatype
    );

    // Initialize the resampler
    await resampler48to24.init();
    isResamplerInitialized = true;
    
    console.log('✅ High-quality resampler initialized successfully');
    console.log('   • Quality: libsoxr VHQ (Very High Quality)');
    console.log('   • Input: 48kHz mono Float32');
    console.log('   • Output: 24kHz mono Float32');
    console.log('   • Channels: 1 (mono)');
    
  } catch (error) {
    console.error('❌ Failed to initialize resampler:', error);
    console.warn('⚠️ Falling back to simple resampling');
    isResamplerInitialized = false;
  }
}

/**
 * Simple 2:1 decimation with basic anti-aliasing filter
 * Used as fallback when high-quality resampler is not available
 */
function resample48to24Simple(f48: Float32Array): Float32Array {
  // console.warn('🔽 Using simple resampling (consider initializing high-quality resampler)');
  
  const outputLength = Math.floor(f48.length / 2);
  const f24 = new Float32Array(outputLength);

  // Simple low-pass filter to reduce aliasing
  // Apply a basic moving average filter before decimation
  const filtered = new Float32Array(f48.length);
  for (let i = 0; i < f48.length; i++) {
    const start = Math.max(0, i - 1);
    const end = Math.min(f48.length - 1, i + 1);
    let sum = 0;
    let count = 0;
    
    for (let j = start; j <= end; j++) {
      sum += f48[j];
      count += 1;
    }
    
    filtered[i] = sum / count;
  }

  // Decimate by 2 (take every other sample)
  for (let i = 0; i < outputLength; i++) {
    f24[i] = filtered[i * 2];
  }

  return f24;
}

/**
 * High-quality resampling from 48kHz to 24kHz using libsoxr
 * Falls back to simple decimation if WebAssembly resampler fails
 */
export function resample48to24HighQuality(f48: Float32Array): Float32Array {
  // Use high-quality resampler if available
  if (isResamplerInitialized && resampler48to24) {
    try {
      // Convert Float32Array to Buffer for the resampler
      // The resampler expects interleaved data, but we have mono so it's already correct
      const inputBuffer = Buffer.from(f48.buffer, f48.byteOffset, f48.byteLength);
      
      // Process the chunk through the resampler
      const resampledBuffer = resampler48to24.processChunk(inputBuffer);
      
      // Convert Buffer back to Float32Array
      const resampledFloat32 = new Float32Array(
        resampledBuffer.buffer,
        resampledBuffer.byteOffset,
        resampledBuffer.byteLength / 4 // 4 bytes per Float32
      );
      
      return resampledFloat32;
    } catch (error) {
      console.warn('⚠️ High-quality resampler failed, falling back to simple:', error);
      // Fall through to simple resampling
    }
  }

  // Fallback: Simple 2:1 decimation with anti-aliasing filter
  return resample48to24Simple(f48);
}


/**
 * Get resampler status and statistics
 */
export function getResamplerInfo(): {
  isInitialized: boolean;
  quality: string;
  inputRate: number;
  outputRate: number;
} {
  return {
    isInitialized: isResamplerInitialized,
    quality: isResamplerInitialized ? 'Very High Quality (libsoxr VHQ)' : 'Simple Decimation',
    inputRate: 48000,
    outputRate: 24000,
  };
}

/**
 * Clean up resampler resources
 */
export function destroyResampler(): void {
  if (resampler48to24) {
    try {
      // Flush any remaining data in the resampler buffer
      // Pass an empty buffer to flush remaining data
      const flushedData = resampler48to24.processChunk(Buffer.alloc(0));
      if (flushedData && flushedData.length > 0) {
        console.log(`🔄 Flushed ${flushedData.length} bytes from resampler buffer`);
      }
      
      // Note: SoxrResampler doesn't have an explicit destroy method
      // The WebAssembly instance will be garbage collected
      resampler48to24 = null;
    } catch (error) {
      console.warn('Warning during resampler cleanup:', error);
      resampler48to24 = null;
    }
  }
  isResamplerInitialized = false;
  console.log('🧹 Audio resampler cleaned up');
}

// Default export for convenience
export { resample48to24HighQuality as resample48to24 };