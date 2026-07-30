const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '../data/blog.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  return new Promise((resolve, reject) => {
    try {
      db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      nickname TEXT NOT NULL, avatar TEXT DEFAULT '/img/default-avatar.png',
      bio TEXT DEFAULT '', email TEXT, role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active', points INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
      exp INTEGER DEFAULT 0, checkin_streak INTEGER DEFAULT 0, last_checkin TEXT,
      admin_permissions TEXT DEFAULT '[]', ban_reason TEXT, ban_until TEXT,
      verified_identity TEXT, identity_type TEXT,
      ip TEXT, created_at TEXT DEFAULT (datetime('now')), last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      icon TEXT DEFAULT '📝', color TEXT DEFAULT '#4a90d9',
      sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
      post_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category_id TEXT,
      title TEXT NOT NULL, content TEXT NOT NULL, summary TEXT,
      cover_image TEXT, images TEXT DEFAULT '[]',
      likes INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0, favorites INTEGER DEFAULT 0, shares INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published', is_anonymous INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0, is_essence INTEGER DEFAULT 0,
      is_draft INTEGER DEFAULT 0, tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      parent_id TEXT, reply_to_id TEXT, reply_to_user_id TEXT,
      content TEXT NOT NULL, likes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published', floor_num INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, target_id TEXT NOT NULL,
      target_type TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, friend_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, user1_id TEXT NOT NULL, user2_id TEXT NOT NULL,
      last_message TEXT, last_message_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL, content TEXT NOT NULL, type TEXT DEFAULT 'text',
      is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      type TEXT DEFAULT 'info', position TEXT DEFAULT 'top',
      is_pinned INTEGER DEFAULT 0, show_popup INTEGER DEFAULT 0,
      start_time TEXT, end_time TEXT, status TEXT DEFAULT 'published',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_id TEXT NOT NULL,
      target_type TEXT NOT NULL, reason TEXT NOT NULL, description TEXT,
      status TEXT DEFAULT 'pending', admin_note TEXT,
      handled_by TEXT, handled_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sensitive_words (
      id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, replacement TEXT DEFAULT '***',
      mode TEXT DEFAULT 'replace', hit_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, description TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checkin_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, points INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS points_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL,
      reason TEXT, balance INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS music (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT,
      url TEXT NOT NULL, cover TEXT, duration INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0, play_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS friend_links (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
      logo TEXT, description TEXT, sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, user_id TEXT, content TEXT NOT NULL,
      contact TEXT, contact_type TEXT DEFAULT 'other',
      status TEXT DEFAULT 'pending', reply TEXT,
      replied_by TEXT, replied_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id TEXT PRIMARY KEY, user_id TEXT, username TEXT, ip TEXT,
      user_agent TEXT, status TEXT, reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT, target TEXT,
      details TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT, content TEXT, from_user_id TEXT,
      target_id TEXT, target_type TEXT,
      is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS identity_verifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      identity_type TEXT NOT NULL, identity_name TEXT NOT NULL,
      reason TEXT, proof_url TEXT, status TEXT DEFAULT 'pending',
      admin_note TEXT, reviewed_by TEXT, reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL,
      post_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT,
      content TEXT, category_id TEXT, tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 初始化默认数据
  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'super_admin'").get();
  if (!adminExists) {
    db.prepare("INSERT INTO users (id,username,password,nickname,role,status) VALUES (?,?,?,?,?,?)").run(
      uuidv4(), 'admin', bcrypt.hashSync('admin123', 10), '超级管理员', 'super_admin', 'active'
    );
    console.log('默认超管: admin / admin123');
  }

  // 默认设置
  const defaults = {
    siteName: 'YS工作室博客论坛', siteDescription: '知识交流社区',
    siteLogo: '/img/logo.png', siteFavicon: '/img/favicon.png',
    siteFooter: '© 2026 YS工作室博客论坛系统',
    maintenanceMode: 'false', maintenanceTitle: '系统维护中',
    maintenanceMessage: '我们正在进行系统升级，预计很快恢复。',
    maintenanceBgColor: '#667eea', maintenanceIcon: '🔧',
    maintenanceCountdown: '', maintenanceContact: '',
    maintenanceCustomCss: '', maintenanceCustomHtml: '',
    allowRegister: 'true', postReview: 'false',
    checkinPoints: '5', registerPoints: '10',
    postPoints: '2', commentPoints: '1', likePoints: '1',
    maxUploadSize: '10', allowedFileTypes: 'jpg,jpeg,png,gif,webp,mp3,mp4',
    carouselAutoPlay: 'true', carouselInterval: '5000',
    enableMusic: 'true', enableFeedback: 'true',
    defaultTheme: 'light'
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!db.prepare("SELECT key FROM settings WHERE key=?").get(k)) {
      db.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run(k, v);
    }
  }

  // 默认板块
  const catExists = db.prepare("SELECT id FROM categories LIMIT 1").get();
  if (!catExists) {
    const cats = [
      { name: '技术交流', desc: '技术问题讨论', icon: '💻', color: '#4a90d9' },
      { name: '日常分享', desc: '生活点滴', icon: '☕', color: '#52c41a' },
      { name: '情感天地', desc: '情感故事', icon: '💕', color: '#ec4899' },
      { name: '资源分享', desc: '资源共享', icon: '📦', color: '#f59e0b' },
      { name: '问答求助', desc: '问题解答', icon: '❓', color: '#8b5cf6' },
      { name: '公告通知', desc: '官方公告', icon: '📢', color: '#ef4444' }
    ];
    cats.forEach((c, i) => {
      db.prepare("INSERT INTO categories (id,name,description,icon,color,sort_order) VALUES (?,?,?,?,?,?)").run(uuidv4(), c.name, c.desc, c.icon, c.color, i);
    });
  }

  console.log('数据库就绪');
      resolve(db);
    } catch (e) { reject(e); }
  });
}

module.exports = { db, initDatabase };
