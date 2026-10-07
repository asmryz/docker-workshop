import React, { useEffect, useState } from 'react'
import Terminal from './Terminal'
import './App.css'

const STORAGE_KEY = 'terminalSessionToken'
const apiBase = () => `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname}:3001`

export default function App() {
  const [regno, setRegno] = useState('')
  const [password, setPassword] = useState('')
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [restoring, setRestoring] = useState(() => !!localStorage.getItem(STORAGE_KEY))

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY)
    if (!token) return
    fetch(`${apiBase()}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    })
      .then(async (response) => {
        if (response.ok) setSession({ ...(await response.json()), sessionToken: token })
        else if (response.status === 401) localStorage.removeItem(STORAGE_KEY)
      })
      .catch((err) => console.error('Session restore failed:', err))
      .finally(() => setRestoring(false))
  }, [])

  const handleSignOut = () => {
    const token = localStorage.getItem(STORAGE_KEY)
    localStorage.removeItem(STORAGE_KEY)
    setSession(null)
    setPassword('')
    if (token) {
      fetch(`${apiBase()}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: token })
      }).catch(() => {})
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
      const response = await fetch(`${protocol}//${window.location.hostname}:3001/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regno: regno.trim(), password })
      })
      const result = await response.json()

      if (!response.ok) {
        setError(result.error || 'Unable to sign in.')
        return
      }

      localStorage.setItem(STORAGE_KEY, result.sessionToken)
      setSession(result)
    } catch (requestError) {
      console.error('Login request failed:', requestError)
      setError('Could not reach the login server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (restoring) return null

  if (session) {
    return (
      <main className="terminal-page">
        <header className="terminal-header">
          <div>
            <span className="terminal-eyebrow">STUDENT TERMINAL</span>
            <h1>{session.instanceName}</h1>
          </div>
          <button className="logout-button" onClick={handleSignOut}>
            Sign out
          </button>
        </header>
        <Terminal ticket={session.ticket} />
      </main>
    )
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-mark" aria-hidden="true">&gt;_</div>
        <p className="login-eyebrow">STUDENT ACCESS</p>
        <h1 id="login-title">Terminal login</h1>
        <p className="login-description">
          Sign in with your registration number to open your terminal.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="regno">Registration number</label>
          <input
            id="regno"
            name="regno"
            type="text"
            autoComplete="username"
            value={regno}
            onChange={(event) => setRegno(event.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {error && <p className="login-error" role="alert">{error}</p>}

          <button className="login-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Preparing terminal…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
