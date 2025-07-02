const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Postgres connection
const pool = new Pool({
  user: 'postgres',
  host: 'metro.proxy.rlwy.net',
  database: 'railway',
  password: 'ZbZTVVGSmGsNIEXHiqMVxThwCBKqSXem',
  port: 32878,
});

// Undo/Redo stacks
let undoStack = [];
let redoStack = [];

// REST API — get version history
app.get('/api/versions', (req, res) => {
  pool.query(
    'SELECT id, content, created_at FROM story_versions WHERE story_id = 1 ORDER BY id DESC',
    (err, result) => {
      if (err) {
        console.error('❌ Error fetching versions:', err);
        res.status(500).json({ error: 'DB error' });
      } else {
        res.json(result.rows);
      }
    }
  );
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  // Load initial content
  pool.query('SELECT content FROM stories WHERE id = 1', (err, result) => {
    if (!err && result.rows.length > 0) {
      const content = result.rows[0].content;
      socket.emit('receive_edit', content);

      // Initialize stacks
      undoStack = [content];
      redoStack = [];
    }
  });

  // Handle edits
  socket.on('send_edit', (data) => {
    const { text, email } = data;
    if (!email) {
      console.log('❌ Unauthorized edit attempt');
      return;
    }

    console.log(`✅ Edit received from ${email}: ${text}`);

    undoStack.push(text);
    redoStack = [];

    pool.query('UPDATE stories SET content = $1 WHERE id = 1', [text]);
    pool.query('INSERT INTO story_versions (story_id, content) VALUES ($1, $2)', [1, text]);

    io.emit('receive_edit', text);
  });

  // Handle undo
  socket.on('undo', ({ email }) => {
    if (!email) {
      console.log('❌ Unauthorized undo attempt');
      return;
    }

    console.log(`✅ Undo received from ${email}`);

    if (undoStack.length > 1) {
      const popped = undoStack.pop();
      redoStack.push(popped);

      const prev = undoStack[undoStack.length - 1];
      pool.query('UPDATE stories SET content = $1 WHERE id = 1', [prev]);
      io.emit('receive_edit', prev);
    } else {
      console.log('⚠️ Nothing to undo');
    }
  });

  // Handle redo
  socket.on('redo', ({ email }) => {
    if (!email) {
      console.log('❌ Unauthorized redo attempt');
      return;
    }

    console.log(`✅ Redo received from ${email}`);

    if (redoStack.length > 0) {
      const redoContent = redoStack.pop();
      undoStack.push(redoContent);

      pool.query('UPDATE stories SET content = $1 WHERE id = 1', [redoContent]);
      io.emit('receive_edit', redoContent);
    } else {
      console.log('⚠️ Nothing to redo');
    }
  });

  // Handle revert to version
  socket.on('revert_version', (versionId) => {
    pool.query(
      'SELECT content FROM story_versions WHERE id = $1',
      [versionId],
      (err, result) => {
        if (err || result.rows.length === 0) {
          console.error('❌ Could not revert version:', err);
        } else {
          const content = result.rows[0].content;
          pool.query('UPDATE stories SET content = $1 WHERE id = 1', [content]);
          undoStack.push(content);
          redoStack = [];
          io.emit('receive_edit', content);
          console.log(`✅ Reverted to version ${versionId}`);
        }
      }
    );
  });

  socket.on('disconnect', () => {
    console.log('👋 Client disconnected:', socket.id);
  });
});

// Start server
server.listen(4000, () => {
  console.log('✅ Server listening on http://localhost:4000');
});
