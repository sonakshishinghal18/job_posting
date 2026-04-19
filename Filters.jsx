import React from 'react'

const FIELDS = ['Engineering', 'Design', 'AI/ML', 'Data', 'Marketing']
const EXPS = ['Junior', 'Mid', 'Senior']
const LOCS = ['Remote', 'Hybrid', 'Bengaluru', 'On-site']
const TYPES = ['Full-time', 'Contract', 'Freelance', 'Internship']

export default function Filters({ filters, toggleArrayFilter, resetFilters }) {
  const hasActive = filters.field.length || filters.experience.length ||
    filters.location.length || filters.job_type.length

  return (
    <aside style={{
      width: 210, flexShrink: 0,
      borderRight: '0.5px solid var(--border)',
      padding: '1.25rem 1rem',
      display: 'flex', flexDirection: 'column', gap: '1.5rem',
      background: 'var(--bg)',
    }}>
      <FilterGroup label="Field" items={FIELDS} active={filters.field} onToggle={v => toggleArrayFilter('field', v)} />
      <FilterGroup label="Experience" items={EXPS} active={filters.experience} onToggle={v => toggleArrayFilter('experience', v)} />
      <FilterGroup label="Location" items={LOCS} active={filters.location} onToggle={v => toggleArrayFilter('location', v)} />
      <FilterGroup label="Job type" items={TYPES} active={filters.job_type} onToggle={v => toggleArrayFilter('job_type', v)} />

      {hasActive && (
        <button onClick={resetFilters} style={{
          fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-md)',
          border: '0.5px solid var(--border-2)', background: 'transparent',
          color: 'var(--text-2)', cursor: 'pointer', alignSelf: 'flex-start',
        }}>
          Clear all
        </button>
      )}
    </aside>
  )
}

function FilterGroup({ label, items, active, onToggle }) {
  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map(item => {
          const isActive = active.includes(item)
          return (
            <button key={item} onClick={() => onToggle(item)} style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 99,
              border: isActive ? '0.5px solid var(--green-border)' : '0.5px solid var(--border)',
              background: isActive ? 'var(--green-bg)' : 'transparent',
              color: isActive ? 'var(--green-text)' : 'var(--text-2)',
              cursor: 'pointer', transition: 'all 0.12s',
            }}>
              {item}
            </button>
          )
        })}
      </div>
    </div>
  )
}
