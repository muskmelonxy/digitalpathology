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
  Edit3,
  Eye,
  Share2,
  X,
  Check
} from 'lucide-react';
import toast from 'react-hot-toast';
import ShareModal from '../components/ShareModal';

export default function Slides() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editingSlide, setEditingSlide] = useState(null);
  const [shareSlideId, setShareSlideId] = useState(null);

  const { data: slides, refetch } = useQuery('slides', () =>
    axios.get('/api/slides').then(res => res.data),
    {
      refetchInterval: (data) => {
        if (!data) return false;
        return data.some(s => s.status === 'processing' || Number(s.pyramid_complete) === 0)
          ? 4000
          : false;
      }
    }
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

  // Clinical info edit
  const startEditing = (slide) => {
    setEditingSlide({
      id: slide.id,
      name: slide.name,
      description: slide.description,
      gender: slide.gender || '',
      age: slide.age || '',
      diagnosis: slide.diagnosis || '',
      other_info: slide.other_info || '',
      case_no: slide.case_no || '',
      sampling_site: slide.sampling_site || '',
      institution: slide.institution || '',
      microscopic: slide.microscopic || '',
      ihc: slide.ihc || ''
    });
  };

  const cancelEditing = () => {
    setEditingSlide(null);
  };

  const updateEditField = (field, value) => {
    setEditingSlide(prev => ({ ...prev, [field]: value }));
  };

  const saveClinicalInfo = async () => {
    try {
      await axios.put(`/api/slides/${editingSlide.id}`, {
        name: editingSlide.name,
        description: editingSlide.description,
        gender: editingSlide.gender,
        age: editingSlide.age,
        diagnosis: editingSlide.diagnosis,
        other_info: editingSlide.other_info,
        case_no: editingSlide.case_no,
        sampling_site: editingSlide.sampling_site,
        institution: editingSlide.institution,
        microscopic: editingSlide.microscopic,
        ihc: editingSlide.ihc
      });
      toast.success('临床信息已更新');
      setEditingSlide(null);
      refetch();
    } catch (error) {
      toast.error('更新失败');
    }
  };

  const filteredSlides = slides?.filter(slide => {
    const matchesSearch = slide.name.toLowerCase().includes(search.toLowerCase()) ||
                         slide.diagnosis?.toLowerCase().includes(search.toLowerCase()) ||
                         slide.description?.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' ||
                         (filter === 'ready' && slide.status === 'ready') ||
                         (filter === 'processing' && slide.status === 'processing');
    return matchesSearch && matchesFilter;
  }) || [];

  const getStatusBadge = (slide) => {
    const status = slide.status;
    const styles = {
      ready: 'bg-green-100 text-green-700',
      processing: 'bg-yellow-100 text-yellow-700',
      error: 'bg-red-100 text-red-700'
    };
    let label = status;
    if (status === 'ready' && Number(slide.pyramid_complete) === 0) {
      label = 'sharpening';
    } else if (status === 'processing' && slide.processing_progress != null) {
      label = `processing ${slide.processing_progress}%`;
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.processing}`}>
        {label}
      </span>
    );
  };

  const ClinicalBadge = ({ label, value, color }) => {
    if (!value) return null;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${color || 'bg-blue-50 text-blue-700'}`}>
        {label}: {value}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">数字切片</h1>
        {user?.role !== 'student' && (
          <Link to="/upload" className="btn-primary inline-flex items-center gap-2">
            <Image className="w-4 h-4" />
            上传切片
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="搜索切片、诊断..."
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
            <option value="all">全部状态</option>
            <option value="ready">已完成</option>
            <option value="processing">处理中</option>
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
          <h3 className="text-lg font-medium text-gray-900 mb-2">未找到切片</h3>
          <p className="text-gray-600">尝试调整搜索条件</p>
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
                  <p className="text-sm text-gray-500 mt-1">{slide.course_name || '未分类'}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {getStatusBadge(slide)}
                    <ClinicalBadge label="病理号" value={slide.case_no} color="bg-indigo-50 text-indigo-700" />
                    <ClinicalBadge label="取材" value={slide.sampling_site} color="bg-teal-50 text-teal-700" />
                    <ClinicalBadge label="性别" value={slide.gender} color="bg-pink-50 text-pink-700" />
                    <ClinicalBadge label="年龄" value={slide.age} color="bg-purple-50 text-purple-700" />
                  </div>
                  {slide.diagnosis && (
                    <p className="text-xs text-gray-600 mt-1 truncate">{slide.diagnosis}</p>
                  )}
                  <span className="text-xs text-gray-400">
                    {new Date(slide.created_at).toLocaleDateString()}
                  </span>
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
                        <Eye className="w-4 h-4" /> 查看
                      </Link>
                      <button
                        onClick={() => startEditing(slide)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 w-full"
                      >
                        <Edit3 className="w-4 h-4" /> 编辑病例信息
                      </button>
                      <button
                        onClick={() => setShareSlideId(slide.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-green-600 hover:bg-green-50 w-full"
                      >
                        <Share2 className="w-4 h-4" /> 分享
                      </button>
                      <button
                        onClick={() => handleDelete(slide.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                      >
                        <Trash2 className="w-4 h-4" /> 删除
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
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">切片</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">课程</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">临床信息</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">状态</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">日期</th>
                {user?.role !== 'student' && (
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">操作</th>
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
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {slide.case_no && <span className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">病理号:{slide.case_no}</span>}
                      {slide.sampling_site && <span className="text-xs bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">取材:{slide.sampling_site}</span>}
                      {slide.gender && <span className="text-xs bg-pink-50 text-pink-700 px-1.5 py-0.5 rounded">性别:{slide.gender}</span>}
                      {slide.age && <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">年龄:{slide.age}</span>}
                      {slide.diagnosis && <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded max-w-[120px] truncate" title={slide.diagnosis}>{slide.diagnosis}</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(slide)}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {new Date(slide.created_at).toLocaleDateString()}
                  </td>
                  {user?.role !== 'student' && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => setShareSlideId(slide.id)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded mr-1"
                        title="分享"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => startEditing(slide)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded mr-1"
                        title="编辑病例信息"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
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

      {/* Edit Clinical Info Modal */}
      {editingSlide && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">编辑病例信息</h2>
              <button onClick={cancelEditing} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">切片名称</label>
                <input
                  type="text"
                  value={editingSlide.name}
                  onChange={(e) => updateEditField('name', e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input
                  type="text"
                  value={editingSlide.description}
                  onChange={(e) => updateEditField('description', e.target.value)}
                  className="input w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
                  <select
                    value={editingSlide.gender}
                    onChange={(e) => updateEditField('gender', e.target.value)}
                    className="input w-full"
                  >
                    <option value="">--</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">年龄</label>
                  <input
                    type="text"
                    value={editingSlide.age}
                    onChange={(e) => updateEditField('age', e.target.value)}
                    placeholder="e.g. 45"
                    className="input w-full"
                  />
                </div>
              </div>
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">病例信息</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">病理号</label>
                    <input
                      type="text"
                      value={editingSlide.case_no}
                      onChange={(e) => updateEditField('case_no', e.target.value)}
                      placeholder="e.g. 2026-0567"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">取材部位</label>
                    <input
                      type="text"
                      value={editingSlide.sampling_site}
                      onChange={(e) => updateEditField('sampling_site', e.target.value)}
                      placeholder="e.g. 右肺上叶"
                      className="input w-full"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">医疗机构</label>
                  <input
                    type="text"
                    value={editingSlide.institution}
                    onChange={(e) => updateEditField('institution', e.target.value)}
                    placeholder="e.g. XX市中心医院病理科"
                    className="input w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">诊断</label>
                <input
                  type="text"
                  value={editingSlide.diagnosis}
                  onChange={(e) => updateEditField('diagnosis', e.target.value)}
                  placeholder="e.g. 肺腺癌"
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">镜下所见</label>
                <textarea
                  rows="2"
                  value={editingSlide.microscopic}
                  onChange={(e) => updateEditField('microscopic', e.target.value)}
                  placeholder="低倍镜、高倍镜下的组织学描述..."
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">免疫组化</label>
                <textarea
                  rows="2"
                  value={editingSlide.ihc}
                  onChange={(e) => updateEditField('ihc', e.target.value)}
                  placeholder="e.g. CK7(+), TTF-1(+)"
                  className="input w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <input
                  type="text"
                  value={editingSlide.other_info}
                  onChange={(e) => updateEditField('other_info', e.target.value)}
                  placeholder="e.g. 手术日期等"
                  className="input w-full"
                />
              </div>
            </div>
            <div className="p-6 border-t flex gap-3 justify-end">
              <button onClick={cancelEditing} className="btn-secondary">取消</button>
              <button onClick={saveClinicalInfo} className="btn-primary flex items-center gap-2">
                <Check className="w-4 h-4" /> 保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareSlideId && (
        <ShareModal slideId={shareSlideId} onClose={() => setShareSlideId(null)} />
      )}
    </div>
  );
}
