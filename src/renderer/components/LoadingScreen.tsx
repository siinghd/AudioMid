import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LoadingScreenProps {
  progress: {
    step: string;
    status: string;
    message: string;
  } | null;
}

function LoadingScreen({ progress }: LoadingScreenProps): React.ReactElement {
  const { isDark } = useTheme();

  const getStepIcon = (step: string, status: string) => {
    if (status === 'completed') {
      return (
        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    
    if (status === 'error') {
      return (
        <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
    
    if (status === 'initializing') {
      return (
        <div className="w-5 h-5">
          <div className={`w-5 h-5 border-2 border-t-transparent rounded-full animate-spin ${
            isDark ? 'border-audiomind-white' : 'border-audiomind-black'
          }`}></div>
        </div>
      );
    }
    
    if (status === 'skipped') {
      return (
        <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    
    return (
      <div className={`w-5 h-5 rounded-full border-2 ${
        isDark ? 'border-audiomind-gray-600' : 'border-audiomind-gray-300'
      }`}></div>
    );
  };

  const steps = [
    { key: 'audio-capture', label: 'Audio Capture' },
    { key: 'ai-pipeline', label: 'AI Pipeline' },
  ];

  return (
    <div className={`w-full h-screen flex items-center justify-center ${
      isDark ? 'bg-audiomind-black text-audiomind-white' : 'bg-audiomind-white text-audiomind-black'
    }`}>
      <div className="max-w-md w-full mx-auto p-8">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 relative">
            <div className={`w-16 h-16 border-4 border-t-transparent rounded-full animate-spin ${
              isDark ? 'border-audiomind-white' : 'border-audiomind-black'
            }`}></div>
            <div className="absolute inset-2 flex items-center justify-center">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                <path d="M12 18v4"/>
                <path d="M8 22h8"/>
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-semibold mb-2">AudioMind</h1>
          <p className={`text-sm ${isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'}`}>
            Initializing audio and AI systems...
          </p>
        </div>

        {/* Progress Steps */}
        <div className="space-y-4">
          {steps.map((step, index) => {
            const isCurrentStep = progress?.step === step.key;
            const currentStepIndex = steps.findIndex(s => s.key === progress?.step);
            
            // Determine step status based on progress
            let stepStatus = 'pending';
            if (progress?.step === 'complete') {
              stepStatus = 'completed'; // All steps completed
            } else if (isCurrentStep) {
              stepStatus = progress?.status || 'pending';
            } else if (currentStepIndex > index) {
              stepStatus = 'completed'; // Previous steps are completed
            }
            
            const isCompleted = stepStatus === 'completed';
            const isError = stepStatus === 'error';
            const isSkipped = stepStatus === 'skipped';
            const isInitializing = stepStatus === 'initializing';
            
            return (
              <div key={step.key} className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${
                isCurrentStep || isCompleted ? (isDark ? 'bg-audiomind-gray-900' : 'bg-audiomind-gray-100') : ''
              }`}>
                {getStepIcon(step.key, stepStatus)}
                <div className="flex-1">
                  <div className={`font-medium ${
                    isCompleted ? 'text-green-500' : 
                    isError ? 'text-red-500' : 
                    isSkipped ? 'text-yellow-500' :
                    isInitializing ? (isDark ? 'text-audiomind-white' : 'text-audiomind-black') :
                    (isDark ? 'text-audiomind-gray-500' : 'text-audiomind-gray-400')
                  }`}>
                    {step.label}
                  </div>
                  {isCurrentStep && progress?.message && (
                    <div className={`text-xs mt-1 ${isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'}`}>
                      {progress.message}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Current Status */}
        {progress && (
          <div className={`mt-6 text-center text-sm ${isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'}`}>
            {progress.message}
          </div>
        )}

        {/* Settings Link */}
        {progress?.status === 'skipped' && (
          <div className="mt-6 text-center">
            <p className={`text-sm mb-3 ${isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'}`}>
              Need to configure your API key?
            </p>
            <button
              onClick={() => window.location.hash = '/settings'}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                isDark 
                  ? 'bg-audiomind-white text-audiomind-black hover:bg-audiomind-gray-100' 
                  : 'bg-audiomind-black text-audiomind-white hover:bg-audiomind-gray-900'
              }`}
            >
              Open Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoadingScreen;