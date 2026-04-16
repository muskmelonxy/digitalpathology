import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  UploadCloud,
  X,
  FileImage,
  Check,
  AlertCircle,
  Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';

const SUPPORTED_FORMATS = ['.tiff', '.tif', '.jpg', '.jpeg', '.png', '.kfb', '.kfbio'];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

export default function Upload() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const { data: courses } = useQuery('courses', () =>
    axios.get('/api/courses').then(res => res.data)
  );

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      name: file.name.replace(/\.[^/.]+$/, ''),
      description: '',
      course_id: '',
      progress: 0,
      status: 'pending', // pending, uploading, processing, done, error
      error: null,
      slideId: null
    }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.tiff', '.tif', '.jpg', '.jpeg', '.png'],
      'application/octet-stream': ['.kfb', '.kfbio']
    },
    maxSize: MAX_FILE_SIZE,
    onDropRejected: (rejected) => {
      rejected.forEach(({ file, errors }) => {
        toast.error(`${file.name}: ${errors[0].message}`);
      });
    }
  });

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const updateFile = (index, updates) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, ...updates } : f));
  };

  const uploadFile = async (fileObj, index) => {
    const formData = new FormData();
    formData.append('slide', fileObj.file);
    formData.append('name', fileObj.name);
    formData.append('description', fileObj.description);
    if (fileObj.course_id) {
      formData.append('course_id', fileObj.course_id);
    }

    try {
      updateFile(index, { status: 'uploading', progress: 0 });

      const response = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          updateFile(index, { progress });
        }
      });

      updateFile(index, {
        status: 'processing',
        progress: 100,
        slideId: response.data.id
      });

      // Poll for processing status
      pollStatus(response.data.id, index);

      return response.data;
    } catch (error) {
      updateFile(index, {
        status: 'error',
        error: error.response?.data?.error || 'Upload failed'
      });
      throw error;
    }
  };

  const pollStatus = async (slideId, index) => {
    const checkStatus = async () => {
      try {
        const response = await axios.get(`/api/upload/status/${slideId}`);
        const { status } = response.data;

        if (status === 'ready') {
          updateFile(index, { status: 'done' });
          queryClient.invalidateQueries('slides');
        } else if (status === 'error') {
          updateFile(index, { status: 'error', error: 'Processing failed' });
        } else {
          // Still processing, poll again
          setTimeout(checkStatus, 2000);
        }
      } catch (error) {
        updateFile(index, { status: 'error', error: 'Failed to check status' });
      }
    };

    checkStatus();
  };

  const handleUploadAll = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) {
      toast.error('No files to upload');
      return;
    }

    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'pending') {
        try {
          await uploadFile(files[i], i);
        } catch (error) {
          // Error already handled in uploadFile
        }
      }
    }

    setUploading(false);
    toast.success('Upload complete!');
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'done':
        return <Check className="w-5 h-5 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      case 'uploading':
      case 'processing':
        return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />;
      default:
        return null;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'uploading':
        return 'Uploading...';
      case 'processing':
        return 'Processing tiles...';
      case 'done':
        return 'Complete';
      case 'error':
        return 'Failed';
      default:
        return 'Ready';
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const doneCount = files.filter(f => f.status === 'done').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Upload Slides</h1>
          <p className="text-gray-600 mt-1">
            Upload TIFF, JPEG, PNG, or KFBIO files
          </p>
        </div>
        {doneCount > 0 && (
          <button
            onClick={() => navigate('/slides')}
            className="btn-secondary"
          >
            View Slides
          </button>
        )}
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <p className="text-lg font-medium text-gray-700">
          {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
        </p>
        <p className="text-gray-500 mt-2">or click to browse</p>
        <p className="text-sm text-gray-400 mt-4">
          Supported: TIFF, JPEG, PNG, KFBIO (max 5GB)
        </p>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Files ({files.length})
              {doneCount > 0 && (
                <span className="ml-2 text-sm font-normal text-green-600">
                  {doneCount} complete
                </span>
              )}
            </h2>
            {pendingCount > 0 && (
              <button
                onClick={handleUploadAll}
                disabled={uploading}
                className="btn-primary"
              >
                {uploading ? 'Uploading...' : `Upload ${pendingCount} Files`}
              </button>
            )}
          </div>

          <div className="space-y-3">
            {files.map((fileObj, index) => (
              <div
                key={index}
                className={`card p-4 ${fileObj.status === 'error' ? 'border-red-300' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileImage className="w-6 h-6 text-gray-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={fileObj.name}
                        onChange={(e) => updateFile(index, { name: e.target.value })}
                        disabled={fileObj.status !== 'pending'}
                        className="font-medium text-gray-900 bg-transparent border-none p-0 focus:ring-0 w-full"
                        placeholder="Slide name"
                      />
                      {getStatusIcon(fileObj.status)}
                    </div>

                    <p className="text-sm text-gray-500">
                      {(fileObj.file.size / (1024 * 1024)).toFixed(2)} MB
                    </p>

                    {fileObj.status === 'pending' && (
                      <div className="flex gap-3 mt-3">
                        <input
                          type="text"
                          value={fileObj.description}
                          onChange={(e) => updateFile(index, { description: e.target.value })}
                          placeholder="Description (optional)"
                          className="input text-sm flex-1"
                        />
                        <select
                          value={fileObj.course_id}
                          onChange={(e) => updateFile(index, { course_id: e.target.value })}
                          className="input text-sm w-48"
                        >
                          <option value="">No Course</option>
                          {courses?.map(course => (
                            <option key={course.id} value={course.id}>{course.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(fileObj.status === 'uploading' || fileObj.status === 'processing') && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span>{getStatusText(fileObj.status)}</span>
                          <span>{fileObj.progress}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{ width: `${fileObj.progress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {fileObj.error && (
                      <p className="text-sm text-red-600 mt-2">{fileObj.error}</p>
                    )}
                  </div>

                  {fileObj.status === 'pending' && (
                    <button
                      onClick={() => removeFile(index)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
