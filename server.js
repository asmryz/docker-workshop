import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import pty from 'node-pty';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const server = http.createServer(app);
const loginTickets = new Map();
const sessions = new Map();
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const instancePreparations = new Map();
const SHELL_INIT = [
  '[ -f ~/.bashrc ] && . ~/.bashrc',
  'eval "$(dircolors -b 2>/dev/null)"',
  "alias ls='ls --color=auto'",
  "alias ll='ls -alF --color=auto'",
  "alias grep='grep --color=auto'"
].join('\n');
const TICKET_LIFETIME_MS = 60_000;

// Demo credentials only. Replace with a trusted credential source before deployment.
const demoCredentials = new Map([
  ['1732102', { password: 'abc.123', section: 'i' }],
  ['2412100', { password: 'abc.123', section: 'i' }],
  ['2412101', { password: 'abc.123', section: 'i' }]
]);

function isAllowedOrigin(origin, requestHost) {
  if (!origin) return true;

  try {
    const url = new URL(origin);
    const requestUrl = new URL(`http://${requestHost}`);
    return (
      url.host === requestUrl.host ||
      (url.port === '9055' && url.hostname === requestUrl.hostname)
    );
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (!isAllowedOrigin(origin, req.get('host'))) {
    return res.sendStatus(403);
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

async function ensureStudentInstance(instanceName) {
  const pendingPreparation = instancePreparations.get(instanceName);
  if (pendingPreparation) return pendingPreparation;

  const preparation = (async () => {
    const { stdout } = await execFileAsync('lxc', ['list', '--format=json']);
    const instances = JSON.parse(stdout);
    const instance = instances.find(({ name }) => name === instanceName);

    if (!instance) {
      await execFileAsync('lxc', ['copy', 'master', instanceName]);
    }

    // Docker (runc) inside the container needs nesting enabled; a change only
    // takes effect after a restart.
    const needsNesting = instance?.config?.['security.nesting'] !== 'true';
    if (needsNesting) {
      await execFileAsync('lxc', ['config', 'set', instanceName, 'security.nesting=true']);
    }

    if (!instance || instance.status !== 'Running') {
      await execFileAsync('lxc', ['start', instanceName]);
    } else if (needsNesting) {
      await execFileAsync('lxc', ['restart', instanceName]);
    }
  })();

  instancePreparations.set(instanceName, preparation);
  try {
    await preparation;
  } finally {
    instancePreparations.delete(instanceName);
  }
}

function issueTicket(instanceName) {
  const now = Date.now();
  for (const [ticket, details] of loginTickets) {
    if (details.expiresAt <= now) loginTickets.delete(ticket);
  }
  const ticket = randomUUID();
  loginTickets.set(ticket, { instanceName, expiresAt: now + TICKET_LIFETIME_MS });
  return ticket;
}

function getSession(token) {
  const session = typeof token === 'string' ? sessions.get(token) : null;
  if (session && session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session ?? null;
}

app.post('/api/session', (req, res) => {
  const session = getSession(req.body?.sessionToken);
  if (!session) return res.status(401).json({ error: 'Session expired.' });
  res.json({ ticket: issueTicket(session.instanceName), instanceName: session.instanceName });
});

app.post('/api/logout', (req, res) => {
  if (typeof req.body?.sessionToken === 'string') sessions.delete(req.body.sessionToken);
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const { regno, password } = req.body ?? {};
  const credentials = typeof regno === 'string' ? demoCredentials.get(regno) : null;

  if (!credentials || typeof password !== 'string' || password !== credentials.password) {
    return res.status(401).json({ error: 'Invalid registration number or password.' });
  }

  const instanceName = `${credentials.section}${regno}`;
  try {
    await ensureStudentInstance(instanceName);

    const sessionToken = randomUUID();
    sessions.set(sessionToken, {
      instanceName,
      expiresAt: Date.now() + SESSION_LIFETIME_MS
    });
    res.json({ ticket: issueTicket(instanceName), instanceName, sessionToken });
  } catch (error) {
    console.error(`Failed to prepare terminal instance "${instanceName}":`, error);
    res.status(500).json({ error: 'Unable to prepare your terminal instance. Please try again.' });
  }
});

// Serve static files from dist after build.
app.use(express.static(path.join(__dirname, 'dist')));

const wss = new WebSocketServer({
  server,
  verifyClient: (info, done) => {
    const origin = info.origin || info.req.headers.origin;
    if (!isAllowedOrigin(origin, info.req.headers.host)) {
      return done(false, 403, 'Origin not allowed');
    }

    const ticket = new URL(info.req.url, 'http://localhost').searchParams.get('ticket');
    const details = ticket && loginTickets.get(ticket);
    if (!details || details.expiresAt <= Date.now()) {
      if (ticket) loginTickets.delete(ticket);
      return done(false, 401, 'Valid login required');
    }

    loginTickets.delete(ticket);
    info.req.terminalInstance = details.instanceName;
    done(true);
  }
});

wss.on('connection', (ws, req) => {
  const instanceName = req.terminalInstance;
  console.log(`Terminal connected to ${instanceName}`);

  let ptyProcess;
  try {
    ptyProcess = pty.spawn('lxc', [
      'exec', instanceName, '--env', 'TERM=xterm-256color', '--',
      'bash', '-c', `exec bash --rcfile <(printf '%s\\n' "$1") -i`, 'bash', SHELL_INIT
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: process.env.HOME,
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      }
    });
  } catch (error) {
    console.error(`Failed to start terminal for "${instanceName}":`, error);
    ws.close(1011, 'Unable to start terminal');
    return;
  }

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'input' && typeof message.data === 'string') {
        ptyProcess.write(message.data);
      } else if (
        message.type === 'resize' &&
        Number.isInteger(message.cols) &&
        Number.isInteger(message.rows) &&
        message.cols > 0 &&
        message.rows > 0
      ) {
        ptyProcess.resize(message.cols, message.rows);
      }
    } catch (error) {
      console.error('Error processing terminal message:', error);
    }
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ws.on('close', () => {
    ptyProcess.kill();
    console.log(`Terminal disconnected from ${instanceName}`);
  });
});

const port = process.env.PORT || 3001;
server.listen(port, '0.0.0.0', () => {
  console.log(`Terminal server running on port ${port}`);
});
