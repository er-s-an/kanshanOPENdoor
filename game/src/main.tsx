import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './experience.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
