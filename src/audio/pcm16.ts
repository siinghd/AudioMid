/**
 * Enhanced Float32 to PCM16 conversion with high-quality resampling
 * Uses WebAssembly libsoxr for professional audio quality
 */

import { 
  resample48to24, 
  initializeResampler, 
  getResamplerInfo, 
  destroyResampler 
} from './resampler';

/**
 * Convert Float32 samples to PCM16 with proper clipping and dithering
 * Optimized for best quality conversion to OpenAI API format
 */
export function floatToPcm16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  
  for (let i = 0; i < f32.length; i++) {
    // Apply soft clipping to avoid harsh distortion
    let sample = f32[i];
    
    // Soft clipping using tanh for more musical distortion
    if (Math.abs(sample) > 0.95) {
      sample = Math.tanh(sample * 0.95) / Math.tanh(0.95);
    }
    
    // Hard clipping as final safety
    sample = Math.max(-1, Math.min(1, sample));
    
    // Add tiny amount of dither to reduce quantization noise
    const dither = (Math.random() - 0.5) * (1.0 / 32768.0);
    sample += dither;
    
    // Convert to 16-bit integer with proper rounding
    out[i] = sample < 0 
      ? Math.round(sample * 32768) 
      : Math.round(sample * 32767);
  }
  
  return out;
}

/**
 * Simple 2:1 decimation with basic anti-aliasing filter
 * Used as fallback when high-quality resampler is not available
 */
export function resample48to24Simple(f48: Float32Array): Float32Array {
  const outputLength = Math.floor(f48.length / 2);
  const f24 = new Float32Array(outputLength);

  // Simple low-pass filter to reduce aliasing
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

// Re-export resampler functions for convenience
export { 
  resample48to24, 
  initializeResampler, 
  getResamplerInfo, 
  destroyResampler 
};