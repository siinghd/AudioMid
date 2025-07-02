{
  "targets": [
    {
      "target_name": "window_privacy",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [ "window_privacy.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-ldwmapi.lib",
            "-luser32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          }
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CFLAGS": [
              "-fobjc-arc"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework CoreGraphics",
              "-framework ApplicationServices",
              "-framework Foundation",
              "-framework AppKit"
            ]
          }
        }],
        ["OS=='linux'", {
          "libraries": [
            "-lX11"
          ]
        }]
      ]
    }
  ]
}