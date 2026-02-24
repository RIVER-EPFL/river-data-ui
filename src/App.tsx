import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminApp from './admin/App';

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  </BrowserRouter>
);

export default App;
