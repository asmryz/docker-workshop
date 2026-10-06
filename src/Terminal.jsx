import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'

const Terminal = ({ ticket }) => {
  const terminalRef = useRef(null)

  useEffect(() => {
    let disposed = false
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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.hostname}:3001?ticket=${encodeURIComponent(ticket)}`
    let ws = null
    const connectTimer = window.setTimeout(() => {
      if (disposed) return

      ws = new WebSocket(wsUrl)
      ws.addEventListener('open', () => {
        term.clear()
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }))
      })

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
        if (!disposed) term.write('\r\nUnable to connect to your terminal.\r\n')
      })

      ws.addEventListener('close', (event) => {
        if (!disposed) {
          const reason = event.reason || `code ${event.code}`
          term.write(`\r\n\nConnection closed (${reason}).\r\n`)
        }
      })
    }, 0)

    term.onData(data => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const handleResize = () => {
      fitAddon.fit()
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'resize', 
          cols: term.cols, 
          rows: term.rows 
        }))
      }
    }

    window.addEventListener('resize', handleResize)

    handleResize()

    return () => {
      disposed = true
      window.clearTimeout(connectTimer)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      ws?.close()
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