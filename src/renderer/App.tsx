import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import AudioAIInterface from './AudioAIInterface';
import Settings from './components/Settings';
import './App.css';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AudioAIInterface />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Router>
  );
}
