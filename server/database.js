const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '../data/database.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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
          share_token TEXT,
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
        } catch (e) {
          // Continue even if default user exists
        }

        // ---- Migration: add share_token column to slides (for pre-existing DBs) ----
        try {
          const cols = await query(`PRAGMA table_info(slides)`);
          if (!cols.some(c => c.name === 'share_token')) {
            await run(`ALTER TABLE slides ADD COLUMN share_token TEXT`);
            console.log('Migration: added share_token column to slides');
          }
        } catch (e) {
          console.error('Migration failed (share_token):', e.message);
        }

        // ---- Migration: add enriched case/metadata columns (病理号/取材部位/机构/镜下所见/免疫组化) ----
        const caseColumns = {
          case_no: 'TEXT',        // 病理号
          sampling_site: 'TEXT',  // 取材部位
          institution: 'TEXT',    // 医疗机构
          microscopic: 'TEXT',    // 镜下所见
          ihc: 'TEXT',            // 免疫组化
          micro_per_px: 'REAL',   // 微米/像素 (kfb CapRes, 用于尺标/倍率)
          gender: 'TEXT',
          age: 'TEXT',
          diagnosis: 'TEXT',
          other_info: 'TEXT',
          processing_progress: 'INTEGER DEFAULT 0',
          processing_message: 'TEXT',
          error_message: 'TEXT',
          tiles_version: 'INTEGER DEFAULT 1',
          pyramid_complete: 'INTEGER DEFAULT 0'
        };
        try {
          const cols = await query(`PRAGMA table_info(slides)`);
          const hadPyramidCol = cols.some(c => c.name === 'pyramid_complete');
          for (const [name, type] of Object.entries(caseColumns)) {
            if (!cols.some(c => c.name === name)) {
              await run(`ALTER TABLE slides ADD COLUMN ${name} ${type}`);
              console.log(`Migration: added ${name} column to slides`);
            }
          }
          // One-shot: slides that were already ready before this column existed
          // already have a full pyramid on disk. Do not rerun on later boots —
          // that would mark an in-flight coarse-first pyramid as complete.
          if (!hadPyramidCol) {
            await run(`UPDATE slides SET pyramid_complete = 1 WHERE status = 'ready'`);
            console.log('Migration: marked existing ready slides pyramid_complete=1');
          }
        } catch (e) {
          console.error('Migration failed (case columns):', e.message);
        }

        resolve();
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
