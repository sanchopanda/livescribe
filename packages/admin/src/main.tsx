import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/global.scss';

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<div style={{ padding: 24 }}>Skribo кабинет — скоро</div>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
