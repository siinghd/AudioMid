#pragma once

#include <vector>
#include <mutex>
#include <deque>
#include <cstdint>
#include <chrono>

namespace AudioCapture {

struct AudioChunk {
    std::vector<int16_t> data;
    uint64_t timestamp;
    uint32_t sampleRate;
    uint16_t channels;
};

struct Float32AudioChunk {
    std::vector<float> data;
    uint64_t timestamp;
    uint32_t sampleRate;
    uint16_t channels;
};

class AudioBuffer {
public:
    explicit AudioBuffer(size_t maxSizeBytes = 5 * 1024 * 1024); // 5MB default
    ~AudioBuffer() = default;
    
    // Add audio data to buffer
    void Push(const std::vector<int16_t>& audioData, uint32_t sampleRate, uint16_t channels);
    
    // Add float32 audio data to buffer
    void PushFloat32(const std::vector<float>& audioData, uint32_t sampleRate, uint16_t channels);
    
    // Get latest audio chunk (non-blocking)
    bool Pop(AudioChunk& chunk);
    
    // Get multiple chunks for batch processing
    std::vector<AudioChunk> PopMultiple(size_t maxChunks = 10);
    
    // Get multiple float32 chunks for batch processing
    std::vector<Float32AudioChunk> PopMultipleFloat32(size_t maxChunks = 10);
    
    // Clear all buffered data
    void Clear();
    
    // Get current buffer size in bytes
    size_t GetSize() const;
    
    // Check if buffer is empty
    bool IsEmpty() const;
    
    // Get buffer usage percentage (0.0 to 1.0)
    float GetUsagePercentage() const;
    
    // Set maximum buffer size
    void SetMaxSize(size_t maxSizeBytes);
    
    // Get buffered duration in milliseconds
    uint64_t GetBufferedDurationMs() const;

private:
    mutable std::mutex mutex_;
    std::deque<AudioChunk> chunks_;
    std::deque<Float32AudioChunk> float32Chunks_;
    size_t maxSizeBytes_;
    size_t currentSizeBytes_;
    
    // Helper to calculate chunk size in bytes
    size_t GetChunkSize(const AudioChunk& chunk) const;
    
    // Remove oldest chunks if buffer is full
    void TrimToSize();
    
    // Get current timestamp
    uint64_t GetCurrentTimestamp() const;
};

} // namespace AudioCapture