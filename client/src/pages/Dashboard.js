import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import {
  Image,
  BookOpen,
  Users,
  Clock,
  ChevronRight
} from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth();

  const { data: slides } = useQuery('slides', () =>
    axios.get('/api/slides').then(res => res.data)
  );

  const { data: courses } = useQuery('courses', () =>
    axios.get('/api/courses').then(res => res.data)
  );

  const recentSlides = slides?.slice(0, 6) || [];

  const stats = [
    {
      label: 'Total Slides',
      value: slides?.length || 0,
      icon: Image,
      color: 'blue'
    },
    {
      label: 'Courses',
      value: courses?.length || 0,
      icon: BookOpen,
      color: 'green'
    },
    {
      label: user?.role === 'student' ? 'Enrolled Courses' : 'Total Students',
      value: user?.role === 'student'
        ? courses?.length || 0
        : courses?.reduce((acc, c) => acc + (c.student_count || 0), 0) || 0,
      icon: Users,
      color: 'purple'
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.username}!
        </h1>
        <p className="text-gray-600 mt-1">
          {user?.role === 'student'
            ? 'Access your course slides and continue learning'
            : 'Manage your slides, courses, and students'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const colorClasses = {
            blue: 'bg-blue-50 text-blue-600',
            green: 'bg-green-50 text-green-600',
            purple: 'bg-purple-50 text-purple-600'
          };
          return (
            <div key={stat.label} className="card flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg ${colorClasses[stat.color]} flex items-center justify-center`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-600">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      {user?.role !== 'student' && (
        <div className="flex flex-wrap gap-4">
          <Link to="/upload" className="btn-primary inline-flex items-center gap-2">
            <Image className="w-4 h-4" />
            Upload New Slide
          </Link>
          <Link to="/courses" className="btn-secondary inline-flex items-center gap-2">
            <BookOpen className="w-4 h-4" />
            Manage Courses
          </Link>
        </div>
      )}

      {/* Recent Slides */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Slides</h2>
          <Link to="/slides" className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm">
            View All
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {recentSlides.length === 0 ? (
          <div className="card text-center py-12">
            <Image className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No slides yet</h3>
            <p className="text-gray-600">
              {user?.role === 'student'
                ? 'Your teacher hasn\'t uploaded any slides yet'
                : 'Upload your first slide to get started'}
            </p>
            {user?.role !== 'student' && (
              <Link to="/upload" className="btn-primary inline-block mt-4">
                Upload Slide
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentSlides.map((slide) => (
              <Link
                key={slide.id}
                to={`/slides/${slide.id}`}
                className="card hover:shadow-lg transition-shadow group"
              >
                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden mb-4">
                  {slide.thumbnail_path ? (
                    <img
                      src={slide.thumbnail_path}
                      alt={slide.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Image className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <h3 className="font-medium text-gray-900 truncate">{slide.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{slide.course_name || 'No Course'}</p>
                <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  {new Date(slide.created_at).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
