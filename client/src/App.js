import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import SlideViewer from './pages/SlideViewer';
import Slides from './pages/Slides';
import Courses from './pages/Courses';
import CourseDetail from './pages/CourseDetail';
import Upload from './pages/Upload';
import Students from './pages/Students';

function PrivateRoute({ children, requireTeacher = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (requireTeacher && user.role === 'student') {
    return <Navigate to="/" />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="slides" element={<Slides />} />
        <Route path="slides/:id" element={<SlideViewer />} />
        <Route path="courses" element={<Courses />} />
        <Route path="courses/:id" element={<CourseDetail />} />
        <Route
          path="upload"
          element={
            <PrivateRoute requireTeacher>
              <Upload />
            </PrivateRoute>
          }
        />
        <Route
          path="students"
          element={
            <PrivateRoute requireTeacher>
              <Students />
            </PrivateRoute>
          }
        />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
