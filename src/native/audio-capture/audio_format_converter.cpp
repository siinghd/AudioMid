#include "audio_format_converter.h"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <cstring>

namespace AudioCapture {

std::vector<float> AudioFormatConverter::ConvertToMonoFloat32(const AudioSample& input) {
    std::vector<float> result;
    
    if (input.data.empty()) {
        return result;
    }
    
    // Debug output disabled for production
    // fprintf(stderr, "FMT  bps=%u  ch=%u  isFloat=%d  nonInter=%d  bytes=%zu\n",
    //         input.format.bitsPerSample,
    //         input.format.channels,
    //         input.format.isFloat,
    //         input.format.isNonInterleaved,
    //         input.data.size());
    
    // Step 1: Convert raw bytes to float samples based on input format
    std::vector<float> samples;
    
    if (input.format.bitsPerSample == 16) {
        // 16-bit to float conversion
        size_t sampleCount = input.data.size() / 2;
        samples.reserve(sampleCount);
        
        const int16_t* int16Samples = reinterpret_cast<const int16_t*>(input.data.data());
        for (size_t i = 0; i < sampleCount; ++i) {
            samples.push_back(int16Samples[i] / 32768.0f);
        }
        
    } else if (input.format.bitsPerSample == 32) {
        // 32-bit samples - check if float or int using format flag
        size_t frameCount = input.data.size() / (4 * input.format.channels);
        size_t totalSamples = frameCount * input.format.channels;
        
        if (input.format.isFloat) {
            const float* floatData = reinterpret_cast<const float*>(input.data.data());
            
            if (input.format.isNonInterleaved && input.format.channels == 2) {
                // Non-interleaved stereo: L L L... R R R...
                samples.reserve(totalSamples);
                const float* leftChannel = floatData;
                const float* rightChannel = floatData + frameCount;
                
                // Convert to interleaved format
                for (size_t frame = 0; frame < frameCount; frame++) {
                    samples.push_back(leftChannel[frame]);
                    samples.push_back(rightChannel[frame]);
                }
            } else {
                // Interleaved or mono - copy directly
                samples.assign(floatData, floatData + totalSamples);
            }
        } else {
            // 32-bit int to float conversion
            const int32_t* int32Samples = reinterpret_cast<const int32_t*>(input.data.data());
            samples.reserve(totalSamples);
            
            for (size_t i = 0; i < totalSamples; ++i) {
                samples.push_back(int32Samples[i] / 2147483648.0f);
            }
        }
    } else {
        // Unsupported format
        return result;
    }
    
    // Step 2: Convert to mono if needed (no resampling - keep 48kHz!)
    if (input.format.channels > 1) {
        size_t frameCount = samples.size() / input.format.channels;
        result.reserve(frameCount);
        
        for (size_t frame = 0; frame < frameCount; frame++) {
            float sum = 0.0f;
            for (uint16_t ch = 0; ch < input.format.channels; ch++) {
                sum += samples[frame * input.format.channels + ch];
            }
            result.push_back(sum / input.format.channels);
        }
    } else {
        result = std::move(samples);
    }
    
    // Debug output disabled for production
    // fprintf(stderr, "MONO frames produced: %zu\n", result.size());
    
    return result;
}

std::vector<int16_t> AudioFormatConverter::ConvertToPCM16(
    const AudioSample& input,
    uint32_t targetSampleRate,
    uint16_t targetChannels) {
    
    std::vector<int16_t> result;
    
    if (input.data.empty()) {
        return result;
    }
    
    // Step 1: Convert raw bytes to int16 samples based on input format
    std::vector<int16_t> samples;
    
    if (input.format.bitsPerSample == 16) {
        // Already 16-bit, just copy
        size_t sampleCount = input.data.size() / 2;
        samples.resize(sampleCount);
        std::memcpy(samples.data(), input.data.data(), input.data.size());
        
    } else if (input.format.bitsPerSample == 32) {
        // Check if it's float or int32 using the format flag
        size_t frameCount = input.data.size() / (4 * input.format.channels);
        size_t totalSamples = frameCount * input.format.channels;
        
        if (input.format.isFloat) {
            // Convert 32-bit float samples
            
            const float* floatData = reinterpret_cast<const float*>(input.data.data());
            
            if (input.format.isNonInterleaved && input.format.channels == 2) {
                // Non-interleaved stereo: L L L... R R R...
                samples.reserve(totalSamples);
                const float* leftChannel = floatData;
                const float* rightChannel = floatData + frameCount;
                
                // Convert to interleaved format
                for (size_t frame = 0; frame < frameCount; frame++) {
                    // Convert left sample
                    float leftSample = std::fmax(-1.0f, std::fmin(1.0f, leftChannel[frame]));
                    int16_t leftInt16 = static_cast<int16_t>(std::lrintf(leftSample * 32768.0f));
                    samples.push_back(leftInt16);
                    
                    // Convert right sample
                    float rightSample = std::fmax(-1.0f, std::fmin(1.0f, rightChannel[frame]));
                    int16_t rightInt16 = static_cast<int16_t>(std::lrintf(rightSample * 32768.0f));
                    samples.push_back(rightInt16);
                }
            } else {
                // Interleaved or mono - use existing path
                samples = FloatToInt16(floatData, totalSamples);
            }
        } else {
            // Convert 32-bit int samples
            const int32_t* int32Samples = reinterpret_cast<const int32_t*>(input.data.data());
            samples = Int32ToInt16(int32Samples, totalSamples);
        }
        
    } else if (input.format.bitsPerSample == 24) {
        // 24-bit to 16-bit conversion
        size_t sampleCount = input.data.size() / 3;
        samples.reserve(sampleCount);
        
        for (size_t i = 0; i < sampleCount; ++i) {
            int32_t sample24 = 0;
            // Assuming little-endian 24-bit
            sample24 = (input.data[i * 3]) |
                      (input.data[i * 3 + 1] << 8) |
                      (input.data[i * 3 + 2] << 16);
            
            // Sign extend if negative
            if (sample24 & 0x800000) {
                sample24 |= 0xFF000000;
            }
            
            // Convert to 16-bit
            int16_t sample16 = static_cast<int16_t>(sample24 >> 8);
            samples.push_back(sample16);
        }
    } else {
        // Unsupported format, return empty
        return result;
    }
    
    // Step 2: Convert to mono if needed
    if (input.format.channels > 1 && targetChannels == 1) {
        samples = StereoToMono(samples);
    }
    
    // Step 3: Skip resampling to avoid distortion - keep native sample rate
    // GPT-4o accepts various sample rates including 48kHz
    
    // Step 4: Skip low-pass filter to preserve audio quality
    // The 8kHz filter was removing too much frequency content
    
    return samples;
}

std::vector<int16_t> AudioFormatConverter::FloatToInt16(
    const float* samples, 
    size_t count) {
    
    std::vector<int16_t> result;
    result.reserve(count);
    
    for (size_t i = 0; i < count; ++i) {
        float sample = samples[i];
        
        // Clamp to [-1.0, 1.0]
        sample = std::max(-1.0f, std::min(1.0f, sample));
        
        // Convert to 16-bit with symmetric scaling and proper rounding
        sample = std::fmax(-1.0f, std::fmin(1.0f, sample));
        int16_t intSample = static_cast<int16_t>(std::lrintf(sample * 32768.0f));
        result.push_back(intSample);
    }
    
    return result;
}

std::vector<int16_t> AudioFormatConverter::Int32ToInt16(
    const int32_t* samples, 
    size_t count) {
    
    std::vector<int16_t> result;
    result.reserve(count);
    
    for (size_t i = 0; i < count; ++i) {
        // Convert from 32-bit to 16-bit
        // Many systems use 24-bit data in 32-bit containers, so shift by 16 bits
        // But also handle full 32-bit range by scaling down
        int32_t sample32 = samples[i];
        
        // Scale from 32-bit range to 16-bit range
        int16_t sample16 = static_cast<int16_t>(sample32 >> 16);
        result.push_back(sample16);
    }
    
    return result;
}

std::vector<int16_t> AudioFormatConverter::Resample(
    const std::vector<int16_t>& input,
    uint32_t inputSampleRate,
    uint32_t outputSampleRate) {
    
    if (inputSampleRate == outputSampleRate) {
        return input;
    }
    
    if (input.empty()) {
        return std::vector<int16_t>();
    }
    
    double ratio = static_cast<double>(inputSampleRate) / outputSampleRate;
    size_t outputLength = static_cast<size_t>(input.size() / ratio);
    
    std::vector<int16_t> output;
    output.reserve(outputLength);
    
    for (size_t i = 0; i < outputLength; ++i) {
        double sourceIndex = i * ratio;
        size_t index = static_cast<size_t>(sourceIndex);
        
        if (index >= input.size() - 1) {
            output.push_back(input.back());
        } else {
            double fraction = sourceIndex - index;
            float interpolated = LinearInterpolate(
                static_cast<float>(input[index]),
                static_cast<float>(input[index + 1]),
                static_cast<float>(fraction)
            );
            output.push_back(static_cast<int16_t>(interpolated));
        }
    }
    
    return output;
}

std::vector<int16_t> AudioFormatConverter::StereoToMono(
    const std::vector<int16_t>& stereoData) {
    
    if (stereoData.size() % 2 != 0) {
        // Invalid stereo data
        return std::vector<int16_t>();
    }
    
    std::vector<int16_t> monoData;
    monoData.reserve(stereoData.size() / 2);
    
    for (size_t i = 0; i < stereoData.size(); i += 2) {
        // Average left and right channels without clipping
        int32_t left = stereoData[i];
        int32_t right = stereoData[i + 1];
        int16_t mono = static_cast<int16_t>((left + right) >> 1);
        monoData.push_back(mono);
    }
    
    return monoData;
}

float AudioFormatConverter::CalculateRMSLevel(
    const std::vector<int16_t>& samples) {
    
    if (samples.empty()) {
        return 0.0f;
    }
    
    double sum = 0.0;
    for (int16_t sample : samples) {
        double normalized = sample / 32768.0;
        sum += normalized * normalized;
    }
    
    double mean = sum / samples.size();
    return static_cast<float>(std::sqrt(mean));
}

std::vector<int16_t> AudioFormatConverter::ApplyLowPassFilter(
    const std::vector<int16_t>& input,
    float cutoffFreq,
    uint32_t sampleRate) {
    
    if (input.empty()) {
        return std::vector<int16_t>();
    }
    
    // Simple single-pole IIR low-pass filter
    float rc = 1.0f / (2.0f * M_PI * cutoffFreq);
    float dt = 1.0f / sampleRate;
    float alpha = dt / (rc + dt);
    
    std::vector<int16_t> output;
    output.reserve(input.size());
    
    float previous = static_cast<float>(input[0]);
    output.push_back(input[0]);
    
    for (size_t i = 1; i < input.size(); ++i) {
        float current = static_cast<float>(input[i]);
        float filtered = previous + alpha * (current - previous);
        previous = filtered;
        output.push_back(static_cast<int16_t>(filtered));
    }
    
    return output;
}

float AudioFormatConverter::LinearInterpolate(float a, float b, float t) {
    return a + t * (b - a);
}

std::vector<int16_t> AudioFormatConverter::MovingAverageFilter(
    const std::vector<int16_t>& input,
    size_t windowSize) {
    
    if (input.empty() || windowSize == 0) {
        return input;
    }
    
    std::vector<int16_t> output;
    output.reserve(input.size());
    
    for (size_t i = 0; i < input.size(); ++i) {
        size_t start = (i >= windowSize / 2) ? (i - windowSize / 2) : 0;
        size_t end = std::min(i + windowSize / 2 + 1, input.size());
        
        int32_t sum = 0;
        for (size_t j = start; j < end; ++j) {
            sum += input[j];
        }
        
        int16_t average = static_cast<int16_t>(sum / (end - start));
        output.push_back(average);
    }
    
    return output;
}

} // namespace AudioCapture