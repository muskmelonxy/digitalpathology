import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import {
  ArrowLeft,
  BookOpen,
  Image,
  Users,
  Plus,
  X,
  Search,
  Check,
  Trash2,
  MoreVertical,
  ChevronRight
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [showSlidesModal, setShowSlidesModal] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [selectedSlides, setSelectedSlides] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const { data: course } = useQuery(['course', id], () =>
    axios.get(`/api/courses/${id}`).then(res => res.data)
  );

  const { data: allStudents } = useQuery('allStudents', () =>
    axios.get('/api/auth/students').then(res => res.data),
    { enabled: user?.role !== 'student' && showEnrollModal }
  );

  const { data: allSlides } = useQuery('allSlides', () =>
    axios.get('/api/slides').then(res => res.data),
    { enabled: user?.role !== 'student' && showSlidesModal }
  );

  const { data: enrolledStudents } = useQuery(['enrolledStudents', id], () =>
    axios.get(`/api/courses/${id}/students`).then(res => res.data),
    { enabled: user?.role !== 'student' }
  );

  const enrollMutation = useMutation(
    () => axios.post(`/api/courses/${id}/enroll`, { student_ids: selectedStudents }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['course', id]);
        queryClient.invalidateQueries(['enrolledStudents', id]);
        setShowEnrollModal(false);
        setSelectedStudents([]);
        toast.success('Students enrolled successfully');
      },
      onError: () => toast.error('Failed to enroll students')
    }
  );

  const removeStudentMutation = useMutation(
    (studentId) => axios.delete(`/api/courses/${id}/enroll/${studentId}`),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['course', id]);
        queryClient.invalidateQueries(['enrolledStudents', id]);
        toast.success('Student removed');
      },
      onError: () => toast.error('Failed to remove student')
    }
  );

  const updateSlidesMutation = useMutation(
    () => Promise.all(
      selectedSlides.map(slideId =>
        axios.put(`/api/slides/${slideId}`, { course_id: id })
      )
    ),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['course', id]);
        queryClient.invalidateQueries('allSlides');
        setShowSlidesModal(false);
        setSelectedSlides([]);
        toast.success('Slides added to course');
      },
      onError: () => toast.error('Failed to add slides')
    }
  );

  const handleEnroll = () => {
    enrollMutation.mutate();
  };

  const handleAddSlides = () => {
    updateSlidesMutation.mutate();
  };

  const toggleStudent = (studentId) => {
    setSelectedStudents(prev =>
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    );
  };

  const toggleSlide = (slideId) => {
    setSelectedSlides(prev =>
      prev.includes(slideId)
        ? prev.filter(id => id !== slideId)
        : [...prev, slideId]
    );
  };

  const filteredStudents = allStudents?.filter(s =>
    !enrolledStudents?.some(e => e.id === s.id) &&
    (s.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
     s.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (!course) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const isTeacher = user?.role !== 'student';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/courses')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{course.name}</h1>
          <p className="text-gray-600">{course.description || 'No description'}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
            <Image className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{course.slides?.length || 0}</p>
            <p className="text-sm text-gray-600">Slides</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-green-100 flex items-center justify-center">
            <Users className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{course.student_count || 0}</p>
            <p className="text-sm text-gray-600">Students</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      {isTeacher && (
        <div className="flex gap-3">
          <button
            onClick={() => setShowEnrollModal(true)}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Users className="w-4 h-4" />
            Enroll Students
          </button>
          <button
            onClick={() => setShowSlidesModal(true)}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Slides
          </button>
        </div>
      )}

      {/* Slides */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Course Slides</h2>
        {course.slides?.length === 0 ? (
          <div className="card text-center py-12">
            <Image className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600">No slides in this course yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {course.slides?.map((slide) => (
              <Link
                key={slide.id}
                to={`/slides/${slide.id}`}
                className="card p-4 hover:shadow-lg transition-shadow group"
              >
                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden mb-3">
                  {slide.thumbnail_path ? (
                    <img
                      src={slide.thumbnail_path}
                      alt={slide.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <Image className="w-10 h-10" />
                    </div>
                  )}
                </div>
                <h3 className="font-medium text-gray-900 truncate">{slide.name}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {new Date(slide.created_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Students */}
      {isTeacher && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Enrolled Students</h2>
          {enrolledStudents?.length === 0 ? (
            <div className="card text-center py-12">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No students enrolled yet</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Student</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Email</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Enrolled</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enrolledStudents?.map((student) => (
                    <tr key={student.id} className="border-t border-gray-100">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium">
                            {student.username[0].toUpperCase()}
                          </div>
                          <span className="font-medium">{student.username}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">{student.email}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {new Date(student.enrolled_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => removeStudentMutation.mutate(student.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Enroll Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">Enroll Students</h2>
              <button onClick={() => setShowEnrollModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input pl-10"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {filteredStudents?.length === 0 ? (
                <p className="text-center text-gray-500 py-4">No available students found</p>
              ) : (
                <div className="space-y-2">
                  {filteredStudents?.map((student) => (
                    <button
                      key={student.id}
                      onClick={() => toggleStudent(student.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        selectedStudents.includes(student.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium">
                        {student.username[0].toUpperCase()}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-medium">{student.username}</p>
                        <p className="text-sm text-gray-500">{student.email}</p>
                      </div>
                      {selectedStudents.includes(student.id) && (
                        <Check className="w-5 h-5 text-blue-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex gap-3">
              <button
                onClick={() => setShowEnrollModal(false)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleEnroll}
                disabled={selectedStudents.length === 0 || enrollMutation.isLoading}
                className="flex-1 btn-primary"
              >
                Enroll {selectedStudents.length > 0 && `(${selectedStudents.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Slides Modal */}
      {showSlidesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">Add Slides to Course</h2>
              <button onClick={() => setShowSlidesModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {allSlides?.filter(s => s.course_id !== parseInt(id)).length === 0 ? (
                <p className="text-center text-gray-500 py-4">No available slides</p>
              ) : (
                <div className="space-y-2">
                  {allSlides
                    ?.filter(s => s.course_id !== parseInt(id))
                    .map((slide) => (
                      <button
                        key={slide.id}
                        onClick={() => toggleSlide(slide.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                          selectedSlides.includes(slide.id)
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="w-12 h-12 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                          {slide.thumbnail_path ? (
                            <img src={slide.thumbnail_path} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Image className="w-5 h-5 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 text-left">
                          <p className="font-medium text-sm">{slide.name}</p>
                          <p className="text-xs text-gray-500">{slide.course_name || 'No course'}</p>
                        </div>
                        {selectedSlides.includes(slide.id) && (
                          <Check className="w-5 h-5 text-blue-600" />
                        )}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex gap-3">
              <button
                onClick={() => setShowSlidesModal(false)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSlides}
                disabled={selectedSlides.length === 0 || updateSlidesMutation.isLoading}
                className="flex-1 btn-primary"
              >
                Add {selectedSlides.length > 0 && `(${selectedSlides.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
