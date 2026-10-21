import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import ViewerPage from './pages/ViewerPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/edit/:id" element={<Editor />} />
      <Route path="/tour/:id" element={<ViewerPage />} />
    </Routes>
  </BrowserRouter>,
);
