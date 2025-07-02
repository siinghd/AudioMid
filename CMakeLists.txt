cmake_minimum_required(VERSION 3.16)
project(ai-audio-assistant-native)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Include directories
include_directories(${CMAKE_SOURCE_DIR}/node_modules/node-addon-api)
include_directories(${CMAKE_SOURCE_DIR}/src/native)
include_directories(${CMAKE_JS_INC})

# Platform-specific configurations
if(WIN32)
    # Windows WASAPI libraries
    set(PLATFORM_LIBS 
        ole32 
        oleaut32 
        avrt 
        mmdevapi 
        ksuser
        winmm
    )
    set(PLATFORM_SOURCES 
        src/native/audio-capture/windows_audio_capture.cpp
    )
    add_definitions(-DWINDOWS_PLATFORM)
    
elseif(APPLE)
    # macOS ScreenCaptureKit and Core Audio
    find_library(FOUNDATION_FRAMEWORK Foundation)
    find_library(AVFOUNDATION_FRAMEWORK AVFoundation)
    find_library(COREMEDIA_FRAMEWORK CoreMedia)
    find_library(SCREENCAPTUREKIT_FRAMEWORK ScreenCaptureKit)
    find_library(COREAUDIO_FRAMEWORK CoreAudio)
    
    set(PLATFORM_LIBS 
        ${FOUNDATION_FRAMEWORK}
        ${AVFOUNDATION_FRAMEWORK}
        ${COREMEDIA_FRAMEWORK}
        ${SCREENCAPTUREKIT_FRAMEWORK}
        ${COREAUDIO_FRAMEWORK}
    )
    set(PLATFORM_SOURCES 
        src/native/audio-capture/macos_audio_capture.mm
    )
    add_definitions(-DMACOS_PLATFORM)
    
    # Enable Objective-C++ for .mm files
    set_source_files_properties(
        src/native/audio-capture/macos_audio_capture.mm
        PROPERTIES 
        COMPILE_FLAGS "-x objective-c++"
    )
    
elseif(UNIX)
    # Linux PulseAudio
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(PULSEAUDIO REQUIRED libpulse-simple libpulse)
    
    set(PLATFORM_LIBS ${PULSEAUDIO_LIBRARIES})
    set(PLATFORM_SOURCES 
        src/native/audio-capture/linux_audio_capture.cpp
    )
    add_definitions(-DLINUX_PLATFORM)
    
    # Add PulseAudio include directories
    include_directories(${PULSEAUDIO_INCLUDE_DIRS})
    link_directories(${PULSEAUDIO_LIBRARY_DIRS})
    
endif()

# WebRTC VAD source files
set(WEBRTC_VAD_SOURCES
    src/native/webrtc-vad/vad_wrapper.cpp
    src/native/webrtc-vad/fvad.c
    src/native/webrtc-vad/signal_processing/division_operations.c
    src/native/webrtc-vad/signal_processing/energy.c
    src/native/webrtc-vad/signal_processing/get_scaling_square.c
    src/native/webrtc-vad/signal_processing/resample_48khz.c
    src/native/webrtc-vad/signal_processing/resample_by_2_internal.c
    src/native/webrtc-vad/signal_processing/resample_fractional.c
    src/native/webrtc-vad/signal_processing/spl_inl.c
    src/native/webrtc-vad/vad/vad_core.c
    src/native/webrtc-vad/vad/vad_filterbank.c
    src/native/webrtc-vad/vad/vad_gmm.c
    src/native/webrtc-vad/vad/vad_sp.c
)

# Common source files
set(COMMON_SOURCES
    src/native/audio-capture/audio_capture_base.cpp
    src/native/audio-capture/audio_buffer.cpp
    src/native/audio-capture/audio_format_converter.cpp
    src/native/audio_capture_addon.cpp
    ${WEBRTC_VAD_SOURCES}
)

# Create the Node.js addon
add_library(audio_capture SHARED 
    ${COMMON_SOURCES}
    ${PLATFORM_SOURCES}
)

# Create the window privacy addon
add_library(window_privacy SHARED 
    src/native/window_privacy.cpp
)

# Set properties for Node.js addon
set_target_properties(audio_capture PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/build"
)

set_target_properties(window_privacy PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/build"
)

# Link libraries
target_link_libraries(audio_capture ${PLATFORM_LIBS})

# Window privacy platform-specific libraries
if(WIN32)
    target_link_libraries(window_privacy dwmapi user32)
elseif(APPLE)
    target_link_libraries(window_privacy 
        "-framework CoreGraphics"
        "-framework ApplicationServices"
        "-framework Foundation"
        "-framework AppKit"
    )
elseif(UNIX AND NOT APPLE)
    target_link_libraries(window_privacy X11)
endif()

# Node.js specific flags
if(WIN32)
    target_compile_definitions(audio_capture PRIVATE 
        NAPI_VERSION=8
        NODE_ADDON_API_DISABLE_DEPRECATED
        WIN32_LEAN_AND_MEAN
        NOMINMAX
    )
    target_compile_definitions(window_privacy PRIVATE 
        NAPI_VERSION=8
        NODE_ADDON_API_DISABLE_DEPRECATED
        WIN32_LEAN_AND_MEAN
        NOMINMAX
    )
else()
    target_compile_definitions(audio_capture PRIVATE 
        NAPI_VERSION=8
        NODE_ADDON_API_DISABLE_DEPRECATED
    )
    target_compile_definitions(window_privacy PRIVATE 
        NAPI_VERSION=8
        NODE_ADDON_API_DISABLE_DEPRECATED
    )
endif()

# Compiler-specific flags
if(MSVC)
    target_compile_options(audio_capture PRIVATE /W4)
    target_compile_options(window_privacy PRIVATE /W4)
else()
    target_compile_options(audio_capture PRIVATE -Wall -Wextra -Wpedantic)
    target_compile_options(window_privacy PRIVATE -Wall -Wextra -Wpedantic)
endif()