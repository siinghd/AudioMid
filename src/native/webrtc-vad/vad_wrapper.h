#pragma once

#include "fvad.h"
#include <cstdint>
#include <memory>

namespace WebRTCVAD {

class VADWrapper {
public:
    // Create VAD with sample rate (8000, 16000, 32000, 48000) and mode (0-3)
    VADWrapper(int sample_rate = 48000, int mode = 2);
    ~VADWrapper();

    // Process audio frame and return speech detection result
    // Returns: 1 = speech, 0 = no speech, -1 = error
    int Process(const int16_t* frame, size_t length);

    // Reset VAD state
    void Reset();

    // Change VAD aggressiveness mode (0-3)
    bool SetMode(int mode);

    // Change sample rate (8000, 16000, 32000, 48000)
    bool SetSampleRate(int sample_rate);

    // Get frame length in samples for given duration in ms
    static size_t GetFrameLength(int sample_rate, int duration_ms);

    // Check if frame length is valid for the sample rate
    bool IsValidFrameLength(size_t length) const;

private:
    std::unique_ptr<Fvad, void(*)(Fvad*)> vad_;
    int sample_rate_;
    int mode_;
};

} // namespace WebRTCVAD