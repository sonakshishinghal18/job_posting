import React, { useState } from 'react'
import { postJob } from '../services/api'

const FIELDS = ['Engineering', 'Design', 'AI/ML', 'Data', 'Marketing']
const EXPS = ['Junior', 'Mid', 'Senior']
const TYPES = ['Full-time', 'Contract', 'Freelance', 'Internship']

export default function PostJobModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    title: '', company: '', field: 'Engineering',
    experience: 'Mid', location: '', job_type: 'Full-time',
    salary: '', description: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async () => {
    if (!form.title || !form.company || !form.location || !form.description) {
      setError('Please fill in all required fields.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await postJob(form)
      onSuccess()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg)', borderRadius: 'var(--radius-lg)',
        border: '0.5px solid var(--border)', padding: '1.5rem',
        width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: 17, fontWeight: 500 }}>Post a job</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--text-2)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Job title *"><input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Senior React Developer" /></Field>
          <Field label="Company *"><input value={form.company} onChange={e => set('company', e.target.value)} placeholder="e.g. Acme Inc." /></Field>
          <Field label="Location *"><input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Remote, Bengaluru" /></Field>
          <Field label="Salary"><input value={form.salary} onChange={e => set('salary', e.target.value)} placeholder="e.g. ₹20–30 LPA" /></Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Field">
              <select value={form.field} onChange={e => set('field', e.target.value)}>
                {FIELDS.map(f => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="Experience">
              <select value={form.experience} onChange={e => set('experience', e.target.value)}>
                {EXPS.map(e => <option key={e}>{e}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Description *">
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Describe the role, responsibilities, and requirements..."
              style={{ minHeight: 100, resize: 'vertical' }} />
          </Field>
        </div>

        {error && <p style={{ fontSize: 13, color: '#a32d2d', marginTop: 8 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 14 }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{ padding: '7px 20px', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--blue-border)', background: 'var(--blue-bg)', color: 'var(--blue-text)', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
            {loading ? 'Posting…' : 'Post job'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>{label}</label>
      {React.cloneElement(children, {
        style: {
          width: '100%', padding: '7px 10px',
          border: '0.5px solid var(--border-2)', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-2)', color: 'var(--text)', fontSize: 14, outline: 'none',
          ...children.props.style,
        },
      })}
    </div>
  )
}
