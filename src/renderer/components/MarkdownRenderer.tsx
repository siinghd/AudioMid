import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

// Enhanced markdown renderer with modern styling
function MarkdownRenderer({ content }: MarkdownRendererProps): React.ReactElement {
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
          elements.push(
            <div key={`code-${index}`} className="my-4 relative group">
              <div className="absolute top-2 right-2 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                {codeLanguage || 'plaintext'}
              </div>
              <pre className="bg-gray-950 border border-gray-800 p-4 rounded-xl overflow-x-auto">
                <code className={`language-${codeLanguage || 'plaintext'} text-sm font-mono text-gray-100`}>
                  {codeLines.join('\n')}
                </code>
              </pre>
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
          <h3 key={`h3-${index}`} className="text-lg font-semibold mt-6 mb-3 text-white">
            {line.slice(4)}
          </h3>
        );
        return;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${index}`} className="text-xl font-bold mt-6 mb-3 text-white">
            {line.slice(3)}
          </h2>
        );
        return;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${index}`} className="text-2xl font-bold mt-6 mb-4 text-white">
            {line.slice(2)}
          </h1>
        );
        return;
      }
      
      // Horizontal rule
      if (line.trim() === '---' || line.trim() === '***') {
        elements.push(
          <hr key={`hr-${index}`} className="my-6 border-gray-700" />
        );
        return;
      }
      
      // Lists
      if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(
          <li key={`li-${index}`} className="ml-6 mb-1 list-disc text-gray-100">
            {renderInlineMarkdown(line.slice(2))}
          </li>
        );
        return;
      }
      
      // Numbered lists
      const numberedMatch = line.match(/^(\d+)\.\s(.+)/);
      if (numberedMatch) {
        elements.push(
          <li key={`ol-${index}`} className="ml-6 mb-1 list-decimal text-gray-100">
            {renderInlineMarkdown(numberedMatch[2])}
          </li>
        );
        return;
      }
      
      // Blockquotes
      if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={`quote-${index}`} className="border-l-4 border-purple-500 pl-4 py-2 my-4 text-gray-300 italic bg-purple-950/20 rounded-r-lg">
            {renderInlineMarkdown(line.slice(2))}
          </blockquote>
        );
        return;
      }
      
      // Regular paragraphs
      if (line.trim()) {
        elements.push(
          <p key={`p-${index}`} className="mb-3 text-gray-100 leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>
        );
      } else if (index > 0 && index < lines.length - 1) {
        // Add spacing between paragraphs
        elements.push(<div key={`space-${index}`} className="h-2" />);
      }
    });
    
    return elements;
  };
  
  const renderInlineMarkdown = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // Combined regex for all inline elements
    const inlineRegex = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let match;
    
    while ((match = inlineRegex.exec(text)) !== null) {
      // Add text before match
      if (match.index > currentIndex) {
        parts.push(text.slice(currentIndex, match.index));
      }
      
      if (match[1]) {
        // Inline code
        parts.push(
          <code key={`code-${match.index}`} className="bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-purple-300">
            {match[2]}
          </code>
        );
      } else if (match[3]) {
        // Bold
        parts.push(
          <strong key={`bold-${match.index}`} className="font-bold text-white">
            {match[4]}
          </strong>
        );
      } else if (match[5]) {
        // Italic
        parts.push(
          <em key={`italic-${match.index}`} className="italic text-gray-200">
            {match[6]}
          </em>
        );
      } else if (match[7]) {
        // Links
        parts.push(
          <a
            key={`link-${match.index}`}
            href={match[9]}
            className="text-purple-400 hover:text-purple-300 underline decoration-purple-400/30 hover:decoration-purple-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            {match[8]}
          </a>
        );
      }
      
      currentIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (currentIndex < text.length) {
      parts.push(text.slice(currentIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };
  
  return (
    <div className="markdown-content">
      {renderContent()}
    </div>
  );
}

export default MarkdownRenderer;