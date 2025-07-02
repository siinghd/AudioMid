#include "vad_wrapper.h"
#include <stdexcept>

namespace WebRTCVAD {

VADWrapper::VADWrapper(int sample_rate, int mode) 
    : vad_(nullptr, fvad_free)
    , sample_rate_(sample_rate)
    , mode_(mode) {
    
    Fvad* raw_vad = fvad_new();
    if (!raw_vad) {
        throw std::runtime_error("Failed to create WebRTC VAD instance");
    }
    
    vad_.reset(raw_vad);
    
    // Set sample rate and mode
    if (fvad_set_sample_rate(vad_.get(), sample_rate) != 0) {
        throw std::runtime_error("Invalid sample rate for WebRTC VAD");
    }
    
    if (fvad_set_mode(vad_.get(), mode) != 0) {
        throw std::runtime_error("Invalid mode for WebRTC VAD");
    }
}

VADWrapper::~VADWrapper() {
    // Destructor handled by unique_ptr with custom deleter
}

int VADWrapper::Process(const int16_t* frame, size_t length) {
    if (!vad_ || !frame) {
        return -1;
    }
    
    // Validate frame length
    if (!IsValidFrameLength(length)) {
        return -1;
    }
    
    return fvad_process(vad_.get(), frame, length);
}

void VADWrapper::Reset() {
    if (vad_) {
        fvad_reset(vad_.get());
        // Restore settings after reset
        fvad_set_sample_rate(vad_.get(), sample_rate_);
        fvad_set_mode(vad_.get(), mode_);
    }
}

bool VADWrapper::SetMode(int mode) {
    if (!vad_ || mode < 0 || mode > 3) {
        return false;
    }
    
    if (fvad_set_mode(vad_.get(), mode) == 0) {
        mode_ = mode;
        return true;
    }
    
    return false;
}

bool VADWrapper::SetSampleRate(int sample_rate) {
    if (!vad_) {
        return false;
    }
    
    if (fvad_set_sample_rate(vad_.get(), sample_rate) == 0) {
        sample_rate_ = sample_rate;
        return true;
    }
    
    return false;
}

size_t VADWrapper::GetFrameLength(int sample_rate, int duration_ms) {
    return (sample_rate * duration_ms) / 1000;
}

bool VADWrapper::IsValidFrameLength(size_t length) const {
    // Valid frame lengths are 10ms, 20ms, or 30ms
    size_t frame_10ms = GetFrameLength(sample_rate_, 10);
    size_t frame_20ms = GetFrameLength(sample_rate_, 20);
    size_t frame_30ms = GetFrameLength(sample_rate_, 30);
    
    return (length == frame_10ms || length == frame_20ms || length == frame_30ms);
}

} // namespace WebRTCVAD