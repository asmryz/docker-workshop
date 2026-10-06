import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import pty from 'node-pty';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);

// Configure WebSocket server with CORS
const wss = new WebSocketServer({ 
  server,
  verifyClient: (info) => {
    // Allow connections from the Vite dev server (localhost and network)
    const origin = info.origin || info.req.headers.origin;
    if (!origin) return true; // Allow connections without origin (like from localhost)
    return origin.includes('localhost:9055') || origin.includes(':9055');
  }
});

// Serve static files from dist after build
app.use(express.static(path.join(__dirname, 'dist')));

// Enable CORS for the Express server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:9055');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Create terminal with larger initial size - connects to d1 container
  const ptyProcess = pty.spawn('lxc', ['exec', 'master', '--', 'bash'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: process.env.HOME,
    env: {
      ...process.env,
      TERM: 'xterm-256color'
    }
  });

  // Handle incoming data from client
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'input') {
        ptyProcess.write(message.data);
      } else if (message.type === 'resize') {
        ptyProcess.resize(message.cols, message.rows);
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // Send terminal output to client
  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'output', data }));
      } catch (err) {
        console.error('Error sending data:', err);
      }
    }
  });

  // Clean up on close
  ws.on('close', () => {
    try {
      ptyProcess.kill();
      console.log('Client disconnected');
    } catch (err) {
      console.error('Error closing pty:', err);
    }
  });
});

const port = process.env.PORT || 3001;
server.listen(port, '0.0.0.0', () => {
  console.log(`Terminal server running on port ${port}`);
});