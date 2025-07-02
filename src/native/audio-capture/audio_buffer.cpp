#include "audio_buffer.h"
#include <algorithm>

namespace AudioCapture {

AudioBuffer::AudioBuffer(size_t maxSizeBytes)
    : maxSizeBytes_(maxSizeBytes)
    , currentSizeBytes_(0) {
}

void AudioBuffer::Push(const std::vector<int16_t>& audioData, uint32_t sampleRate, uint16_t channels) {
    if (audioData.empty()) return;
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    AudioChunk chunk;
    chunk.data = audioData;
    chunk.timestamp = GetCurrentTimestamp();
    chunk.sampleRate = sampleRate;
    chunk.channels = channels;
    
    size_t chunkSize = GetChunkSize(chunk);
    
    chunks_.push_back(std::move(chunk));
    currentSizeBytes_ += chunkSize;
    
    // Remove old chunks if buffer is too large
    TrimToSize();
}

void AudioBuffer::PushFloat32(const std::vector<float>& audioData, uint32_t sampleRate, uint16_t channels) {
    if (audioData.empty()) return;
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    Float32AudioChunk chunk;
    chunk.data = audioData;
    chunk.timestamp = GetCurrentTimestamp();
    chunk.sampleRate = sampleRate;
    chunk.channels = channels;
    
    size_t chunkSize = audioData.size() * sizeof(float);
    
    float32Chunks_.push_back(std::move(chunk));
    currentSizeBytes_ += chunkSize;
    
    // Remove old chunks if buffer is too large
    TrimToSize();
}

bool AudioBuffer::Pop(AudioChunk& chunk) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (chunks_.empty()) {
        return false;
    }
    
    chunk = std::move(chunks_.front());
    currentSizeBytes_ -= GetChunkSize(chunk);
    chunks_.pop_front();
    
    return true;
}

std::vector<AudioChunk> AudioBuffer::PopMultiple(size_t maxChunks) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    std::vector<AudioChunk> result;
    result.reserve(std::min(maxChunks, chunks_.size()));
    
    size_t count = 0;
    while (!chunks_.empty() && count < maxChunks) {
        AudioChunk chunk = std::move(chunks_.front());
        currentSizeBytes_ -= GetChunkSize(chunk);
        chunks_.pop_front();
        
        result.push_back(std::move(chunk));
        count++;
    }
    
    return result;
}

std::vector<Float32AudioChunk> AudioBuffer::PopMultipleFloat32(size_t maxChunks) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    std::vector<Float32AudioChunk> result;
    result.reserve(std::min(maxChunks, float32Chunks_.size()));
    
    size_t count = 0;
    while (!float32Chunks_.empty() && count < maxChunks) {
        Float32AudioChunk chunk = std::move(float32Chunks_.front());
        currentSizeBytes_ -= chunk.data.size() * sizeof(float);
        float32Chunks_.pop_front();
        
        result.push_back(std::move(chunk));
        count++;
    }
    
    return result;
}

void AudioBuffer::Clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    chunks_.clear();
    float32Chunks_.clear();
    currentSizeBytes_ = 0;
}

size_t AudioBuffer::GetSize() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return currentSizeBytes_;
}

bool AudioBuffer::IsEmpty() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return chunks_.empty();
}

float AudioBuffer::GetUsagePercentage() const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (maxSizeBytes_ == 0) return 0.0f;
    return static_cast<float>(currentSizeBytes_) / static_cast<float>(maxSizeBytes_);
}

void AudioBuffer::SetMaxSize(size_t maxSizeBytes) {
    std::lock_guard<std::mutex> lock(mutex_);
    maxSizeBytes_ = maxSizeBytes;
    TrimToSize();
}

uint64_t AudioBuffer::GetBufferedDurationMs() const {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (chunks_.empty()) return 0;
    
    uint64_t totalSamples = 0;
    uint32_t avgSampleRate = 0;
    
    for (const auto& chunk : chunks_) {
        totalSamples += chunk.data.size() / chunk.channels;
        avgSampleRate = chunk.sampleRate; // Use last sample rate
    }
    
    if (avgSampleRate == 0) return 0;
    
    return (totalSamples * 1000) / avgSampleRate;
}

size_t AudioBuffer::GetChunkSize(const AudioChunk& chunk) const {
    return sizeof(AudioChunk) + (chunk.data.size() * sizeof(int16_t));
}

void AudioBuffer::TrimToSize() {
    while (currentSizeBytes_ > maxSizeBytes_ && !chunks_.empty()) {
        const auto& oldestChunk = chunks_.front();
        currentSizeBytes_ -= GetChunkSize(oldestChunk);
        chunks_.pop_front();
    }
}

uint64_t AudioBuffer::GetCurrentTimestamp() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();
}

} // namespace AudioCapture