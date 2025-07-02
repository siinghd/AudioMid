#pragma once

#include <functional>
#include <memory>
#include <vector>
#include <cstdint>
#include <string>

namespace AudioCapture {

struct AudioFormat {
    uint32_t sampleRate;
    uint16_t channels;
    uint16_t bitsPerSample;
    uint32_t bytesPerFrame;
    uint32_t blockAlign;
    bool isFloat = false;         // Whether samples are floating-point format
    bool isNonInterleaved = false; // Whether channels are in separate planes
    uint32_t formatFlags = 0;     // Raw format flags for debugging
};

struct AudioSample {
    std::vector<uint8_t> data;
    AudioFormat format;
    uint64_t timestamp;
    uint32_t frameCount;
};

// Callback for audio data
using AudioCallback = std::function<void(const AudioSample& sample)>;

// Base class for platform-specific audio capture implementations
class AudioCaptureBase {
public:
    virtual ~AudioCaptureBase() = default;
    
    // Start audio capture
    virtual bool Start() = 0;
    
    // Stop audio capture
    virtual bool Stop() = 0;
    
    // Check if currently capturing
    virtual bool IsCapturing() const = 0;
    
    // Set the callback for audio data
    virtual void SetAudioCallback(AudioCallback callback) = 0;
    
    // Get current audio format
    virtual AudioFormat GetFormat() const = 0;
    
    // Get available audio devices
    virtual std::vector<std::string> GetAvailableDevices() = 0;
    
    // Set the device to capture from (optional, default uses system default)
    virtual bool SetDevice(const std::string& deviceId) = 0;
    
    // Get current volume level (0.0 to 1.0)
    virtual float GetVolumeLevel() const = 0;
    
    // Get last error message
    virtual std::string GetLastError() const = 0;

protected:
    AudioCallback audioCallback_;
    AudioFormat currentFormat_;
    bool isCapturing_ = false;
    std::string lastError_;
    float currentVolumeLevel_ = 0.0f;
};

// Factory function to create platform-specific implementation
std::unique_ptr<AudioCaptureBase> CreateAudioCapture();

} // namespace AudioCapture