const express = require('express');
const router = express.Router();
const { query, get, run } = require('../database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Get all courses
router.get('/', authenticateToken, async (req, res) => {
  try {
    let courses;

    if (req.user.role === 'teacher' || req.user.role === 'admin') {
      courses = await query(`
        SELECT c.*, u.username as teacher_name,
               (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count,
               (SELECT COUNT(*) FROM slides WHERE course_id = c.id AND status = 'ready') as slide_count
        FROM courses c
        JOIN users u ON c.teacher_id = u.id
        WHERE c.teacher_id = ?
        ORDER BY c.created_at DESC
      `, [req.user.id]);
    } else {
      courses = await query(`
        SELECT c.*, u.username as teacher_name,
               (SELECT COUNT(*) FROM slides WHERE course_id = c.id AND status = 'ready') as slide_count
        FROM courses c
        JOIN users u ON c.teacher_id = u.id
        JOIN enrollments e ON c.id = e.course_id
        WHERE e.student_id = ?
        ORDER BY c.created_at DESC
      `, [req.user.id]);
    }

    res.json(courses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single course with slides
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const course = await get(`
      SELECT c.*, u.username as teacher_name,
             (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) as student_count
      FROM courses c
      JOIN users u ON c.teacher_id = u.id
      WHERE c.id = ?
    `, [req.params.id]);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check access
    if (req.user.role === 'student') {
      const enrollment = await get(
        'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?',
        [req.params.id, req.user.id]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (course.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get slides for this course
    const slides = await query(`
      SELECT s.*, u.username as uploaded_by_name
      FROM slides s
      LEFT JOIN users u ON s.uploaded_by = u.id
      WHERE s.course_id = ? AND s.status = 'ready'
      ORDER BY s.created_at DESC
    `, [req.params.id]);

    res.json({ ...course, slides });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create course (teacher/admin only)
router.post('/', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { name, description } = req.body;

    const result = await run(
      'INSERT INTO courses (name, description, teacher_id) VALUES (?, ?, ?)',
      [name, description, req.user.id]
    );

    const course = await get('SELECT * FROM courses WHERE id = ?', [result.id]);
    res.status(201).json(course);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update course
router.put('/:id', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { name, description } = req.body;

    const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await run(
      'UPDATE courses SET name = ?, description = ? WHERE id = ?',
      [name, description, req.params.id]
    );

    const updated = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete course
router.delete('/:id', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await run('DELETE FROM courses WHERE id = ?', [req.params.id]);
    res.json({ message: 'Course deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enroll students
router.post('/:id/enroll', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { student_ids } = req.body; // Array of student IDs

    const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    for (const student_id of student_ids) {
      try {
        await run(
          'INSERT INTO enrollments (course_id, student_id) VALUES (?, ?)',
          [req.params.id, student_id]
        );
      } catch (e) {
        // Ignore duplicate enrollment errors
        if (!e.message.includes('UNIQUE constraint failed')) {
          throw e;
        }
      }
    }

    res.json({ message: 'Students enrolled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove student enrollment
router.delete('/:id/enroll/:studentId', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await run(
      'DELETE FROM enrollments WHERE course_id = ? AND student_id = ?',
      [req.params.id, req.params.studentId]
    );

    res.json({ message: 'Student removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get enrolled students
router.get('/:id/students', authenticateToken, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const course = await get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const students = await query(`
      SELECT u.id, u.username, u.email, e.enrolled_at
      FROM users u
      JOIN enrollments e ON u.id = e.student_id
      WHERE e.course_id = ?
    `, [req.params.id]);

    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
