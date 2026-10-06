import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'

const Terminal = () => {
  const terminalRef = useRef(null)
  const [status, setStatus] = React.useState('connecting')
  const [error, setError] = React.useState(null)

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#0f1724',
        foreground: '#e6eef6'
      },
      fontSize: 18,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace'
    })

    const fitAddon = new FitAddon()
    const webLinks = new WebLinksAddon()
    
    term.loadAddon(fitAddon)
    term.loadAddon(webLinks)

    // Open terminal in the container
    term.open(terminalRef.current)
    fitAddon.fit()

    // Watch for container resize (e.g., when divider is dragged)
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch (err) {
        console.error('Error fitting terminal:', err)
      }
    })

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    // Setup WebSocket connection to terminal server
    // Use the same hostname as the current page (works with both localhost and IP)
    const wsUrl = `ws://${window.location.hostname}:3001`
    let ws = new WebSocket(wsUrl)

    // Handle connection open
    ws.addEventListener('open', () => {
      setStatus('connected')
      setError(null)
      term.clear()
      
      // Send initial terminal dimensions
      ws.send(JSON.stringify({ 
        type: 'resize', 
        cols: term.cols, 
        rows: term.rows 
      }))
    })

    // Handle incoming messages
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'output') {
          term.write(msg.data)
        }
      } catch (err) {
        console.error('Failed to parse message:', err)
        term.write(ev.data)
      }
    })

    ws.addEventListener('error', (event) => {
      console.error('WebSocket error:', event)
      setError('Failed to connect to terminal server')
      setStatus('error')
    })

    ws.addEventListener('close', () => {
      setStatus('disconnected')
      term.write('\r\n\nConnection closed. Attempting to reconnect...\r\n')
      
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (ws.readyState === WebSocket.CLOSED) {
          ws = new WebSocket(wsUrl)
          setStatus('connecting')
        }
      }, 3000)
    })

    // Handle terminal input
    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'resize', 
          cols: term.cols, 
          rows: term.rows 
        }))
      }
    }

    window.addEventListener('resize', handleResize)

    // Do initial fit
    handleResize()

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      ws.close()
      term.dispose()
    }
  }, [])

  return (
    <div className="terminal-wrapper">
      <div className="terminal-container" ref={terminalRef} />
    </div>
  )
}

export default Terminal