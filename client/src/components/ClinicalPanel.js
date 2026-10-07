import React, { useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

const FIELDS = [
  { key: 'case_title', label: '病例 / 标题', hint: 'Case title' },
  { key: 'sex', label: '性别', hint: 'Sex', placeholder: '女 / 男 / 其他' },
  { key: 'age', label: '年龄', hint: 'Age', placeholder: '例如 54' },
  { key: 'site', label: '取材部位', hint: 'Site' },
  { key: 'clinical_diagnosis', label: '临床诊断 / 印象', hint: 'Clinical impression', long: true },
  { key: 'pathology_findings', label: '病理所见', hint: 'Pathology findings', long: true },
  { key: 'remarks', label: '备注', hint: 'Remarks', long: true },
  { key: 'notes', label: '补充说明', hint: 'Notes', long: true },
];

function blankDraft(source) {
  const draft = {};
  FIELDS.forEach(({ key }) => {
    draft[key] = source && typeof source[key] === 'string' ? source[key] : '';
  });
  return draft;
}

export default function ClinicalPanel({ root, filename }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role === 'teacher' || user?.role === 'admin';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => blankDraft());
  const [saving, setSaving] = useState(false);

  const query = useQuery(
    ['wsi-clinical', root, filename],
    () => axios
      .get(`/api/wsi/r/${encodeURIComponent(root)}/${encodeURIComponent(filename)}/clinical`)
      .then((res) => res.data),
    { enabled: Boolean(root && filename), retry: false }
  );

  const data = query.data;
  const filled = FIELDS.filter(({ key }) => data && String(data[key] || '').trim());
  const isEmpty = !data || data.empty || filled.length === 0;

  const startEdit = () => {
    setDraft(blankDraft(data));
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await axios.put(
        `/api/wsi/r/${encodeURIComponent(root)}/${encodeURIComponent(filename)}/clinical`,
        draft
      );
      queryClient.setQueryData(['wsi-clinical', root, filename], response.data);
      toast.success('临床信息已保存');
      setEditing(false);
    } catch (error) {
      const message = error.response?.data?.error || '保存失败';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="clinical-block">
      <div className="clinical-head">
        <div>
          <h3>临床信息</h3>
          <p>Clinical notes</p>
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn-quiet" onClick={startEdit}>
            {isEmpty ? '填写' : '编辑'}
          </button>
        )}
      </div>

      {query.isLoading && <p className="clinical-empty">正在读取临床信息…</p>}
      {query.isError && (
        <p className="clinical-empty">暂时无法读取临床信息。</p>
      )}

      {!query.isLoading && !query.isError && editing && (
        <form
          className="clinical-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {FIELDS.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.long ? (
                <textarea
                  value={draft[field.key] || ''}
                  maxLength={4000}
                  placeholder={field.placeholder || field.hint}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))}
                />
              ) : (
                <input
                  value={draft[field.key] || ''}
                  maxLength={4000}
                  placeholder={field.placeholder || field.hint}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))}
                />
              )}
            </label>
          ))}
          <div className="clinical-actions">
            <button type="submit" className="btn-quiet" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              className="btn-quiet is-ghost"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {!query.isLoading && !query.isError && !editing && isEmpty && (
        <p className="clinical-empty">
          尚未填写临床信息。
          {canEdit ? ' 点击「填写」补充病例说明。' : ''}
        </p>
      )}

      {!query.isLoading && !query.isError && !editing && !isEmpty && (
        <dl className="clinical-list">
          {filled.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>{data[field.key]}</dd>
            </div>
          ))}
        </dl>
      )}

      {!editing && data?.updated_at && !isEmpty && (
        <p className="clinical-meta">
          最近更新 {String(data.updated_at).replace('T', ' ').replace('Z', ' UTC')}
          {data.updated_by ? ` · ${data.updated_by}` : ''}
        </p>
      )}
    </section>
  );
}
