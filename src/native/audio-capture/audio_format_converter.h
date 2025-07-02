#pragma once

#include "audio_capture_base.h"
#include <vector>
#include <cstdint>

namespace AudioCapture {

class AudioFormatConverter {
public:
    // Convert audio sample to clean 48kHz mono float32 (for high-quality resampling)
    static std::vector<float> ConvertToMonoFloat32(
        const AudioSample& input
    );
    
    // Convert audio sample to PCM16 format (legacy - for direct use)
    static std::vector<int16_t> ConvertToPCM16(
        const AudioSample& input,
        uint32_t targetSampleRate = 48000,  // Keep native sample rate
        uint16_t targetChannels = 1         // Mono
    );
    
    // Convert float samples to int16
    static std::vector<int16_t> FloatToInt16(
        const float* samples, 
        size_t count
    );
    
    // Convert int32 samples to int16
    static std::vector<int16_t> Int32ToInt16(
        const int32_t* samples, 
        size_t count
    );
    
    // Resample audio data
    static std::vector<int16_t> Resample(
        const std::vector<int16_t>& input,
        uint32_t inputSampleRate,
        uint32_t outputSampleRate
    );
    
    // Convert stereo to mono
    static std::vector<int16_t> StereoToMono(
        const std::vector<int16_t>& stereoData
    );
    
    // Calculate RMS level for volume indication
    static float CalculateRMSLevel(
        const std::vector<int16_t>& samples
    );
    
    // Apply simple low-pass filter to reduce noise
    static std::vector<int16_t> ApplyLowPassFilter(
        const std::vector<int16_t>& input,
        float cutoffFreq = 8000.0f,  // 8kHz cutoff
        uint32_t sampleRate = 24000
    );

private:
    // Linear interpolation for resampling
    static float LinearInterpolate(float a, float b, float t);
    
    // Simple moving average filter
    static std::vector<int16_t> MovingAverageFilter(
        const std::vector<int16_t>& input,
        size_t windowSize
    );
};

} // namespace AudioCapture