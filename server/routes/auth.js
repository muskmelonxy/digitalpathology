const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { get, run, query } = require('../database');
const { generateToken, authenticateToken } = require('../middleware/auth');

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register (teachers/admins only can create accounts, or self-register as student)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role = 'student' } = req.body;

    // Only allow student self-registration, teacher/admin require existing teacher/admin
    if (role !== 'student') {
      return res.status(403).json({ error: 'Cannot self-register as teacher/admin' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const result = await run(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, role]
    );

    const user = await get('SELECT * FROM users WHERE id = ?', [result.id]);
    const token = generateToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Create user (teacher/admin only)
router.post('/create-user', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only teachers and admins can create users' });
    }

    const { username, email, password, role = 'student' } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);

    const result = await run(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, role]
    );

    const user = await get('SELECT id, username, email, role FROM users WHERE id = ?', [result.id]);
    res.status(201).json(user);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await get('SELECT id, username, email, role FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all students (teacher/admin only)
router.get('/students', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const students = await query('SELECT id, username, email FROM users WHERE role = ?', ['student']);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
