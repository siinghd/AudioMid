import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import AudioAIInterface from './AudioAIInterface';
import Settings from './components/Settings';
import { ThemeProvider } from './contexts/ThemeContext';
import './App.css';

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<AudioAIInterface />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}