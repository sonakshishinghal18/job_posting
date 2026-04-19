import React, { useState } from 'react'
import Filters from './components/Filters'
import JobCard from './components/JobCard'
import PostJobModal from './components/PostJobModal'
import { useJobs } from './hooks/useJobs'

const SOURCES = [
  { key: 'all', label: 'All' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'indeed', label: 'Indeed' },
  { key: 'ai', label: 'AI Search' },
  { key: 'user', label: 'Posted' },
]

export default function App() {
  const { jobs, total, loading, error, filters, aiSummary, updateFilter, toggleArrayFilter, resetFilters, runAiSearch } = useJobs()
  const [aiQuery, setAiQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [successMsg, setSuccessMsg] = useState(null)

  const handleAiSearch = e => {
    e.preventDefault()
    runAiSearch(aiQuery)
  }

  const handleJobPosted = () => {
    setSuccessMsg('Job posted successfully!')
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-3)' }}>

      {/* Header */}
      <header style={{
        background: 'var(--bg)', borderBottom: '0.5px solid var(--border)',
        padding: '0 1.5rem', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <span style={{ fontWeight: 500, fontSize: 16 }}>JobBoard</span>
        <button onClick={() => setShowModal(true)} style={{
          fontSize: 13, padding: '6px 16px', borderRadius: 'var(--radius-md)',
          border: '0.5px solid var(--blue-border)', background: 'var(--blue-bg)',
          color: 'var(--blue-text)', cursor: 'pointer', fontWeight: 500,
        }}>
          + Post a job
        </button>
      </header>

      {/* AI search bar */}
      <div style={{ background: 'var(--bg)', borderBottom: '0.5px solid var(--border)', padding: '0.75rem 1.5rem' }}>
        <form onSubmit={handleAiSearch} style={{ display: 'flex', gap: 10, maxWidth: 720 }}>
          <input
            value={aiQuery}
            onChange={e => setAiQuery(e.target.value)}
            placeholder='Try AI search: "remote senior ML engineer" or "junior data role in Bengaluru"'
            style={{
              flex: 1, height: 38, padding: '0 14px',
              border: '0.5px solid var(--border-2)', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-2)', color: 'var(--text)', fontSize: 14, outline: 'none',
            }}
          />
          <button type="submit" disabled={!aiQuery.trim() || loading} style={{
            padding: '0 18px', height: 38, borderRadius: 'var(--radius-md)',
            border: '0.5px solid var(--border-2)', background: 'var(--bg-2)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            AI Search ✦
          </button>
        </form>
        {aiSummary && (
          <p style={{ fontSize: 13, color: 'var(--blue-text)', marginTop: 6 }}>✦ {aiSummary}</p>
        )}
      </div>

      <div style={{ display: 'flex', maxWidth: 1100, margin: '0 auto', minHeight: 'calc(100vh - 120px)' }}>

        {/* Sidebar */}
        <Filters filters={filters} toggleArrayFilter={toggleArrayFilter} resetFilters={resetFilters} />

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Toolbar */}
          <div style={{
            background: 'var(--bg)', borderBottom: '0.5px solid var(--border)',
            padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            {/* Source tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SOURCES.map(s => (
                <button key={s.key} onClick={() => updateFilter('source', s.key)} style={{
                  fontSize: 12, padding: '4px 12px', borderRadius: 'var(--radius-md)',
                  border: filters.source === s.key ? '0.5px solid var(--blue-border)' : '0.5px solid var(--border)',
                  background: filters.source === s.key ? 'var(--blue-bg)' : 'transparent',
                  color: filters.source === s.key ? 'var(--blue-text)' : 'var(--text-2)',
                  cursor: 'pointer',
                }}>
                  {s.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                {loading ? 'Loading…' : `${total} job${total !== 1 ? 's' : ''}`}
              </span>
              <select value={filters.sort} onChange={e => updateFilter('sort', e.target.value)} style={{
                fontSize: 12, padding: '4px 8px', borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--border)', background: 'transparent',
                color: 'var(--text-2)', cursor: 'pointer',
              }}>
                <option value="recent">Most recent</option>
                <option value="salary">Highest salary</option>
              </select>
            </div>
          </div>

          {/* Success / error banners */}
          {successMsg && (
            <div style={{ background: 'var(--green-bg)', color: 'var(--green-text)', padding: '10px 1.25rem', fontSize: 13 }}>
              {successMsg}
            </div>
          )}
          {error && (
            <div style={{ background: '#fcebeb', color: '#a32d2d', padding: '10px 1.25rem', fontSize: 13 }}>
              Error: {error}
            </div>
          )}

          {/* Job list */}
          <div style={{ flex: 1, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {loading && <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Loading jobs…</p>}
            {!loading && jobs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-2)' }}>
                <p style={{ marginBottom: 12 }}>No jobs match your filters.</p>
                <button onClick={resetFilters} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--border-2)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer' }}>
                  Clear filters
                </button>
              </div>
            )}
            {!loading && jobs.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        </main>
      </div>

      {showModal && <PostJobModal onClose={() => setShowModal(false)} onSuccess={handleJobPosted} />}
    </div>
  )
}
