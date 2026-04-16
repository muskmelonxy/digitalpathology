import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import {
  Image,
  Search,
  Filter,
  Grid,
  List,
  MoreVertical,
  Trash2,
  Edit,
  Eye
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function Slides() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const { data: slides, refetch } = useQuery('slides', () =>
    axios.get('/api/slides').then(res => res.data)
  );

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this slide?')) return;

    try {
      await axios.delete(`/api/slides/${id}`);
      toast.success('Slide deleted');
      refetch();
    } catch (error) {
      toast.error('Failed to delete slide');
    }
  };

  const filteredSlides = slides?.filter(slide => {
    const matchesSearch = slide.name.toLowerCase().includes(search.toLowerCase()) ||
                         slide.description?.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' ||
                         (filter === 'ready' && slide.status === 'ready') ||
                         (filter === 'processing' && slide.status === 'processing');
    return matchesSearch && matchesFilter;
  }) || [];

  const getStatusBadge = (status) => {
    const styles = {
      ready: 'bg-green-100 text-green-700',
      processing: 'bg-yellow-100 text-yellow-700',
      error: 'bg-red-100 text-red-700'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.processing}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Slides</h1>
        {user?.role !== 'student' && (
          <Link to="/upload" className="btn-primary inline-flex items-center gap-2">
            <Image className="w-4 h-4" />
            Upload Slide
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search slides..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input"
          >
            <option value="all">All Status</option>
            <option value="ready">Ready</option>
            <option value="processing">Processing</option>
          </select>
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-white shadow' : ''}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow' : ''}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Slides Grid/List */}
      {filteredSlides.length === 0 ? (
        <div className="card text-center py-16">
          <Image className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No slides found</h3>
          <p className="text-gray-600">Try adjusting your search or filters</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredSlides.map((slide) => (
            <div key={slide.id} className="card p-4 group">
              <Link to={`/slides/${slide.id}`} className="block">
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
              </Link>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <Link to={`/slides/${slide.id}`}>
                    <h3 className="font-medium text-gray-900 truncate hover:text-blue-600">{slide.name}</h3>
                  </Link>
                  <p className="text-sm text-gray-500 mt-1">{slide.course_name || 'No Course'}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {getStatusBadge(slide.status)}
                    <span className="text-xs text-gray-400">
                      {new Date(slide.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {user?.role !== 'student' && (
                  <div className="relative group/menu">
                    <button className="p-1 hover:bg-gray-100 rounded">
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                    <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 hidden group-hover/menu:block z-10">
                      <Link
                        to={`/slides/${slide.id}`}
                        className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        <Eye className="w-4 h-4" /> View
                      </Link>
                      <button
                        onClick={() => handleDelete(slide.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Slide</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Course</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Date</th>
                {user?.role !== 'student' && (
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredSlides.map((slide) => (
                <tr key={slide.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <Link to={`/slides/${slide.id}`} className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {slide.thumbnail_path ? (
                          <img src={slide.thumbnail_path} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Image className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <span className="font-medium text-gray-900 hover:text-blue-600">{slide.name}</span>
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">{slide.course_name || '-'}</td>
                  <td className="py-3 px-4">{getStatusBadge(slide.status)}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {new Date(slide.created_at).toLocaleDateString()}
                  </td>
                  {user?.role !== 'student' && (
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDelete(slide.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
