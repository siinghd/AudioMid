import React, { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
  forceColors?: {
    text: string;
    heading: string;
    code: string;
    codeBg: string;
    quoteBg: string;
    quoteBorder: string;
    link: string;
    linkHover: string;
  };
}

function MarkdownRenderer({ content, forceColors }: MarkdownRendererProps): React.ReactElement {
  const { isDark } = useTheme();
  
  // Memoize syntax highlighting to avoid re-highlighting on every render
  const highlightCode = useMemo(() => {
    return (code: string, language: string): string => {
      if (!language || language === 'plaintext') {
        return hljs.highlightAuto(code).value;
      }
      
      try {
        return hljs.highlight(code, { language }).value;
      } catch (e) {
        // Fallback to auto-detection if specific language fails
        return hljs.highlightAuto(code).value;
      }
    };
  }, []);
  
  const renderContent = () => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLanguage = '';
    
    lines.forEach((line, index) => {
      // Code blocks
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLanguage = line.slice(3).trim();
          codeLines = [];
        } else {
          inCodeBlock = false;
          const codeContent = codeLines.join('\n');
          const highlightedCode = highlightCode(codeContent, codeLanguage);
          
          elements.push(
            <div key={`code-${index}`} className="my-4 relative group">
              <div className={`absolute top-2 right-2 text-xs opacity-60 transition-opacity z-10 ${
                isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'
              }`}>
                {codeLanguage || 'auto-detected'}
              </div>
              <div className={`border rounded-lg overflow-hidden ${
                isDark 
                  ? 'bg-audiomind-gray-950 border-audiomind-gray-800' 
                  : 'bg-audiomind-gray-50 border-audiomind-gray-200'
              }`}>
                <pre className="p-4 overflow-x-auto">
                  <code 
                    className="font-mono text-sm hljs"
                    dangerouslySetInnerHTML={{ __html: highlightedCode }}
                  />
                </pre>
              </div>
            </div>
          );
          codeLines = [];
        }
        return;
      }
      
      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }
      
      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${index}`} className={`text-lg font-semibold mt-4 mb-2 ${
            forceColors?.heading || (isDark ? 'text-audiomind-white' : 'text-audiomind-black')
          }`}>
            {line.slice(4)}
          </h3>
        );
        return;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${index}`} className={`text-xl font-bold mt-4 mb-2 ${
            forceColors?.heading || (isDark ? 'text-audiomind-white' : 'text-audiomind-black')
          }`}>
            {line.slice(3)}
          </h2>
        );
        return;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${index}`} className={`text-2xl font-bold mt-4 mb-3 ${
            forceColors?.heading || (isDark ? 'text-audiomind-white' : 'text-audiomind-black')
          }`}>
            {line.slice(2)}
          </h1>
        );
        return;
      }
      
      // Horizontal rule
      if (line.trim() === '---' || line.trim() === '***') {
        elements.push(
          <hr key={`hr-${index}`} className={`my-6 ${
            isDark ? 'border-audiomind-gray-800' : 'border-audiomind-gray-300'
          }`} />
        );
        return;
      }
      
      // Lists
      if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(
          <li key={`li-${index}`} className={`ml-6 mb-1 list-disc ${
            isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'
          }`}>
            {renderInlineMarkdown(line.slice(2))}
          </li>
        );
        return;
      }
      
      // Numbered lists
      const numberedMatch = line.match(/^(\d+)\.\s(.+)/);
      if (numberedMatch) {
        elements.push(
          <li key={`ol-${index}`} className={`ml-6 mb-1 list-decimal ${
            isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800'
          }`}>
            {renderInlineMarkdown(numberedMatch[2])}
          </li>
        );
        return;
      }
      
      // Blockquotes
      if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={`quote-${index}`} className={`border-l-4 pl-4 py-2 my-4 italic rounded-r-lg ${
            isDark 
              ? 'border-audiomind-gray-600 text-audiomind-gray-300 bg-audiomind-gray-900' 
              : 'border-audiomind-gray-400 text-audiomind-gray-700 bg-audiomind-gray-100'
          }`}>
            {renderInlineMarkdown(line.slice(2))}
          </blockquote>
        );
        return;
      }
      
      // Regular paragraphs
      if (line.trim()) {
        elements.push(
          <p key={`p-${index}`} className={`mb-2 leading-relaxed ${
            forceColors?.text || (isDark ? 'text-audiomind-gray-200' : 'text-audiomind-gray-800')
          }`}>
            {renderInlineMarkdown(line)}
          </p>
        );
      } else if (index > 0 && index < lines.length - 1) {
        elements.push(<div key={`space-${index}`} className="h-1" />);
      }
    });
    
    // Handle incomplete code block (during streaming)
    if (inCodeBlock && codeLines.length > 0) {
      const codeContent = codeLines.join('\n');
      const highlightedCode = highlightCode(codeContent, codeLanguage);
      
      elements.push(
        <div key={`code-incomplete`} className="my-4 relative group">
          <div className={`absolute top-2 right-2 text-xs opacity-60 transition-opacity z-10 ${
            isDark ? 'text-audiomind-gray-400' : 'text-audiomind-gray-600'
          }`}>
            {codeLanguage || 'auto-detected'} • streaming...
          </div>
          <div className={`border rounded-lg overflow-hidden ${
            isDark 
              ? 'bg-audiomind-gray-950 border-audiomind-gray-800' 
              : 'bg-audiomind-gray-50 border-audiomind-gray-200'
          }`}>
            <pre className="p-4 overflow-x-auto">
              <code 
                className="font-mono text-sm hljs"
                dangerouslySetInnerHTML={{ __html: highlightedCode }}
              />
            </pre>
          </div>
        </div>
      );
    }
    
    return elements;
  };
  
  const renderInlineMarkdown = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    const inlineRegex = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let match;
    
    while ((match = inlineRegex.exec(text)) !== null) {
      if (match.index > currentIndex) {
        parts.push(text.slice(currentIndex, match.index));
      }
      
      if (match[1]) {
        // Inline code
        parts.push(
          <code key={`code-${match.index}`} className={`px-1.5 py-0.5 rounded text-sm font-mono ${
            isDark 
              ? 'bg-audiomind-gray-800 text-audiomind-gray-300' 
              : 'bg-audiomind-gray-200 text-audiomind-gray-800'
          }`}>
            {match[2]}
          </code>
        );
      } else if (match[3]) {
        // Bold
        parts.push(
          <strong key={`bold-${match.index}`} className={`font-bold ${
            isDark ? 'text-audiomind-white' : 'text-audiomind-black'
          }`}>
            {match[4]}
          </strong>
        );
      } else if (match[5]) {
        // Italic
        parts.push(
          <em key={`italic-${match.index}`} className={`italic ${
            isDark ? 'text-audiomind-gray-300' : 'text-audiomind-gray-700'
          }`}>
            {match[6]}
          </em>
        );
      } else if (match[7]) {
        // Links
        parts.push(
          <a
            key={`link-${match.index}`}
            href={match[9]}
            className={`underline transition-colors ${
              isDark 
                ? 'text-audiomind-gray-300 hover:text-audiomind-white decoration-audiomind-gray-600 hover:decoration-audiomind-gray-400' 
                : 'text-audiomind-gray-700 hover:text-audiomind-black decoration-audiomind-gray-400 hover:decoration-audiomind-gray-600'
            }`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {match[8]}
          </a>
        );
      }
      
      currentIndex = match.index + match[0].length;
    }
    
    if (currentIndex < text.length) {
      parts.push(text.slice(currentIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };
  
  return (
    <div className={`markdown-content ${isDark ? 'dark-theme' : 'light-theme'}`}>
      <style>{`
        .markdown-content.dark-theme .hljs {
          background: transparent !important;
          color: #e5e7eb !important;
        }
        .markdown-content.light-theme .hljs {
          background: transparent !important;
          color: #374151 !important;
        }
        .markdown-content.dark-theme .hljs-keyword,
        .markdown-content.dark-theme .hljs-selector-tag,
        .markdown-content.dark-theme .hljs-literal,
        .markdown-content.dark-theme .hljs-title,
        .markdown-content.dark-theme .hljs-type,
        .markdown-content.dark-theme .hljs-name {
          color: #818cf8 !important;
        }
        .markdown-content.light-theme .hljs-keyword,
        .markdown-content.light-theme .hljs-selector-tag,
        .markdown-content.light-theme .hljs-literal,
        .markdown-content.light-theme .hljs-title,
        .markdown-content.light-theme .hljs-type,
        .markdown-content.light-theme .hljs-name {
          color: #6366f1 !important;
        }
        .markdown-content.dark-theme .hljs-string,
        .markdown-content.dark-theme .hljs-title.function_ {
          color: #34d399 !important;
        }
        .markdown-content.light-theme .hljs-string,
        .markdown-content.light-theme .hljs-title.function_ {
          color: #059669 !important;
        }
        .markdown-content .hljs-comment,
        .markdown-content .hljs-quote {
          font-style: italic;
        }
        .markdown-content.dark-theme .hljs-comment,
        .markdown-content.dark-theme .hljs-quote {
          color: #9ca3af !important;
        }
        .markdown-content.light-theme .hljs-comment,
        .markdown-content.light-theme .hljs-quote {
          color: #6b7280 !important;
        }
        .markdown-content.dark-theme .hljs-number,
        .markdown-content.dark-theme .hljs-symbol {
          color: #f87171 !important;
        }
        .markdown-content.light-theme .hljs-number,
        .markdown-content.light-theme .hljs-symbol {
          color: #dc2626 !important;
        }
      `}</style>
      {renderContent()}
    </div>
  );
}

export default MarkdownRenderer;