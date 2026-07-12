const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  const { execSync } = require('child_process');
  console.log('Generating self-signed certificate...');
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=GyroDrive"`,
    { stdio: 'inherit' }
  );
  console.log('Created cert.pem + key.pem');
}

const httpApp = express();
httpApp.use((req, res, next) => {
  if (req.url === '/controller.html' || req.url.startsWith('/controller')) {
    const host = req.headers.host.split(':')[0];
    return res.redirect(`https://${host}:8443${req.url}`);
  }
  next();
});
httpApp.use(express.static('.'));

const httpsApp = express();
httpsApp.use(express.static('.'));

const httpServer = http.createServer(httpApp);
const httpsServer = https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  httpsApp
);

const io = new Server();
io.attach(httpServer);
io.attach(httpsServer);

io.on('connection', (socket) => {
  let role = null;

  socket.on('join_game', () => {
    role = 'game';
  });

  socket.on('join_controller', () => {
    role = 'controller';
    socket.broadcast.emit('controller_status', { connected: true });
  });

  socket.on('tilt', (data) => {
    if (role === 'controller') {
      socket.broadcast.emit('tilt', data);
    }
  });

  socket.on('disconnect', () => {
    if (role === 'controller') {
      socket.broadcast.emit('controller_status', { connected: false });
    }
  });
});

httpServer.listen(8080, '0.0.0.0', () => {
  console.log('Game:        http://localhost:8080');
  console.log('Controller:  https://<ip>:8443/controller.html');
});

httpsServer.listen(8443, '0.0.0.0', () => {
  console.log('HTTPS ready');
});
