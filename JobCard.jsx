import React from 'react'

const LOGOS = {
  Stripe: '💳', Figma: '🎨', Cohere: '🤖', Razorpay: '⚡',
  Swiggy: '🍜', Google: 'G', Cloudflare: '☁️', Zomato: '🔴',
  Notion: '📝', DeepMind: '🧠', Zepto: '⚡', Atlassian: '🔷',
}

const LOGO_COLORS = {
  Stripe: '#eeedfe', Figma: '#faece7', Cohere: '#e1f5ee', Razorpay: '#faeeda',
  Swiggy: '#eaf3de', Google: '#e6f1fb', Cloudflare: '#faeeda', Zomato: '#fcebeb',
  Notion: '#f1f0ea', DeepMind: '#eeedfe', Zepto: '#eaf3de', Atlassian: '#e6f1fb',
}

const SOURCE_LABELS = { linkedin: 'LinkedIn', indeed: 'Indeed', ai: 'AI Search', user: 'Posted' }

export default function JobCard({ job }) {
  const logo = LOGOS[job.company] || job.company[0]
  const logoBg = LOGO_COLORS[job.company] || '#f1f0ea'

  return (
    <div style={{
      background: 'var(--bg)',
      border: job.featured ? '1.5px solid var(--blue-border)' : '0.5px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '1rem 1.25rem',
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--radius-md)',
          background: logoBg, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 17, flexShrink: 0,
        }}>
          {logo}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 15, fontWeight: 500 }}>{job.title}</h3>
            {job.featured && <Badge bg="var(--blue-bg)" color="var(--blue-text)">Featured</Badge>}
            {job.days_ago === 0 && <Badge bg="var(--green-bg)" color="var(--green-text)">New today</Badge>}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{job.company}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <Badge bg="var(--green-bg)" color="var(--green-text)">{job.field}</Badge>
        <Badge bg="var(--purple-bg)" color="var(--purple-text)">{job.experience}</Badge>
        <Badge bg="var(--green-bg)" color="var(--green-text)">{job.location}</Badge>
        <Badge bg="var(--amber-bg)" color="var(--amber-text)">{job.type}</Badge>
        <Badge bg="var(--bg-2)" color="var(--text-2)" border="0.5px solid var(--border)">{SOURCE_LABELS[job.source] || job.source}</Badge>
      </div>

      <p style={{
        fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 10,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {job.description}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{job.salary}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {job.days_ago === 0 ? 'Today' : job.days_ago === 1 ? 'Yesterday' : `${job.days_ago}d ago`}
        </span>
        <button style={{
          fontSize: 12, padding: '5px 14px', borderRadius: 'var(--radius-md)',
          border: '0.5px solid var(--border-2)', background: 'transparent',
          color: 'var(--text)', cursor: 'pointer',
        }}>
          Apply ↗
        </button>
      </div>
    </div>
  )
}

function Badge({ children, bg, color, border }) {
  return (
    <span style={{
      fontSize: 11, padding: '3px 8px', borderRadius: 99,
      background: bg, color, fontWeight: 500, border: border || 'none',
    }}>
      {children}
    </span>
  )
}
