import { useState, useEffect, useCallback } from 'react'
import { fetchJobs, aiSearch } from '../services/api'

export function useJobs() {
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [aiSummary, setAiSummary] = useState(null)

  const [filters, setFilters] = useState({
    field: [],
    experience: [],
    location: [],
    job_type: [],
    source: 'all',
    q: '',
    sort: 'recent',
  })

  const load = useCallback(async (currentFilters) => {
    setLoading(true)
    setError(null)
    setAiSummary(null)
    try {
      const data = await fetchJobs(currentFilters)
      setJobs(data.jobs)
      setTotal(data.total)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(filters)
  }, [filters, load])

  const runAiSearch = useCallback(async (query) => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await aiSearch(query)
      setJobs(data.jobs)
      setTotal(data.total)
      setAiSummary(data.summary)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const updateFilter = useCallback((key, value) => {
    setAiSummary(null)
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  const toggleArrayFilter = useCallback((key, value) => {
    setAiSummary(null)
    setFilters(prev => {
      const arr = prev[key]
      return {
        ...prev,
        [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      }
    })
  }, [])

  const resetFilters = useCallback(() => {
    setAiSummary(null)
    setFilters({ field: [], experience: [], location: [], job_type: [], source: 'all', q: '', sort: 'recent' })
  }, [])

  return { jobs, total, loading, error, filters, aiSummary, updateFilter, toggleArrayFilter, resetFilters, runAiSearch }
}
