const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('.'));

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

server.listen(8080, '0.0.0.0', () => {
  console.log('Gyro Drive running at http://localhost:8080');
});
