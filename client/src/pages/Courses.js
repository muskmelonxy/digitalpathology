import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import {
  BookOpen,
  Plus,
  Users,
  Image,
  MoreVertical,
  Edit,
  Trash2,
  X,
  Search
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function Courses() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCourse, setNewCourse] = useState({ name: '', description: '' });

  const { data: courses } = useQuery('courses', () =>
    axios.get('/api/courses').then(res => res.data)
  );

  const createMutation = useMutation(
    (data) => axios.post('/api/courses', data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('courses');
        setShowCreateModal(false);
        setNewCourse({ name: '', description: '' });
        toast.success('Course created successfully');
      },
      onError: () => toast.error('Failed to create course')
    }
  );

  const deleteMutation = useMutation(
    (id) => axios.delete(`/api/courses/${id}`),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('courses');
        toast.success('Course deleted');
      },
      onError: () => toast.error('Failed to delete course')
    }
  );

  const handleCreate = (e) => {
    e.preventDefault();
    createMutation.mutate(newCourse);
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this course?')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Courses</h1>
        {user?.role !== 'student' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Course
          </button>
        )}
      </div>

      {courses?.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No courses yet</h3>
          <p className="text-gray-600">
            {user?.role === 'student'
              ? 'You haven\'t been enrolled in any courses yet'
              : 'Create your first course to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses?.map((course) => (
            <div key={course.id} className="card hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-blue-600" />
                </div>
                {user?.role !== 'student' && (
                  <div className="relative group">
                    <button className="p-1 hover:bg-gray-100 rounded">
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                    <div className="absolute right-0 mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 hidden group-hover:block z-10">
                      <button
                        onClick={() => handleDelete(course.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <Link to={`/courses/${course.id}`}>
                <h3 className="font-semibold text-gray-900 text-lg hover:text-blue-600">{course.name}</h3>
              </Link>
              <p className="text-gray-600 mt-2 line-clamp-2">{course.description || 'No description'}</p>

              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <Image className="w-4 h-4" />
                  {course.slide_count || 0} slides
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <Users className="w-4 h-4" />
                  {course.student_count || 0} students
                </div>
              </div>

              <Link
                to={`/courses/${course.id}`}
                className="mt-4 block text-center py-2 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm font-medium text-gray-700 transition-colors"
              >
                View Course
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">Create New Course</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Course Name</label>
                <input
                  type="text"
                  value={newCourse.name}
                  onChange={(e) => setNewCourse({ ...newCourse, name: e.target.value })}
                  className="input"
                  placeholder="Enter course name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={newCourse.description}
                  onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })}
                  className="input h-24 resize-none"
                  placeholder="Enter course description (optional)"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isLoading}
                  className="flex-1 btn-primary"
                >
                  {createMutation.isLoading ? 'Creating...' : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
