const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '../data/database.sqlite');

let db = null;

function getDatabase() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH);
  }
  return db;
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = getDatabase();

    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT DEFAULT 'student' CHECK(role IN ('student', 'teacher', 'admin')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Courses table
      db.run(`
        CREATE TABLE IF NOT EXISTS courses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          teacher_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (teacher_id) REFERENCES users(id)
        )
      `);

      // Course enrollments
      db.run(`
        CREATE TABLE IF NOT EXISTS enrollments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          course_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (course_id) REFERENCES courses(id),
          FOREIGN KEY (student_id) REFERENCES users(id),
          UNIQUE(course_id, student_id)
        )
      `);

      // Slides table
      db.run(`
        CREATE TABLE IF NOT EXISTS slides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          filename TEXT NOT NULL,
          original_format TEXT NOT NULL,
          status TEXT DEFAULT 'processing' CHECK(status IN ('processing', 'ready', 'error')),
          width INTEGER,
          height INTEGER,
          tile_size INTEGER DEFAULT 256,
          max_level INTEGER,
          thumbnail_path TEXT,
          course_id INTEGER,
          uploaded_by INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (course_id) REFERENCES courses(id),
          FOREIGN KEY (uploaded_by) REFERENCES users(id)
        )
      `, async (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Create default teacher account
        try {
          await createDefaultUser();
          resolve();
        } catch (e) {
          resolve(); // Continue even if default user exists
        }
      });
    });
  });
}

function createDefaultUser() {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    const hashedPassword = bcrypt.hashSync('teacher123', 10);

    db.run(
      `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
      ['teacher', 'teacher@example.com', hashedPassword, 'teacher'],
      function(err) {
        if (err) {
          reject(err);
        } else {
          console.log('Default teacher created: teacher / teacher123');
          resolve();
        }
      }
    );
  });
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

module.exports = {
  getDatabase,
  initDatabase,
  query,
  run,
  get
};
