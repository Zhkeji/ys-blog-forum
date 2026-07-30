const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, db } = require('./database');
const { setupSocket } = require('./socket');
const { loadSettings } = require('./settings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.set('io', io);

// 维护模式
app.use((req, res, next) => {
  try {
    const s = loadSettings();
    if (s.maintenanceMode === 'true' && !req.path.startsWith('/admin') && !req.path.startsWith('/api/') && !req.path.startsWith('/socket.io') && !req.path.startsWith('/img/') && !req.path.startsWith('/css/') && !req.path.startsWith('/js/') && !req.path.startsWith('/uploads/')) {
      return res.sendFile(path.join(__dirname, '../views/maintenance.html'));
    }
  } catch (e) {}
  next();
});

// 博客公开API（不需要登录）
app.get('/api/blog/posts', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = 20;
    const offset = (page - 1) * limit;
    const total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='published' AND is_draft=0").get().c;
    const posts = db.prepare("SELECT p.*,u.nickname as author_name,u.avatar as author_avatar,u.verified_identity,u.identity_type as author_identity_type,c.name as category_name,c.icon as category_icon FROM posts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN categories c ON p.category_id=c.id WHERE p.status='published' AND p.is_draft=0 ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
    res.json({ code: 200, data: { posts: posts.map(x => { let img=[],tag=[]; try{img=JSON.parse(x.images);}catch(e){} try{tag=JSON.parse(x.tags);}catch(e){} return {...x,images:img,tags:tag,author_name:x.is_anonymous?'匿名用户':x.author_name,author_avatar:x.is_anonymous?'/img/default-avatar.png':x.author_avatar}; }), pagination: { page, limit, total, totalPages: Math.ceil(total/limit) } } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

app.get('/api/blog/posts/:id', (req, res) => {
  try {
    db.prepare('UPDATE posts SET views=views+1 WHERE id=?').run(req.params.id);
    const p = db.prepare("SELECT p.*,u.nickname as author_name,u.avatar as author_avatar,u.verified_identity,u.identity_type as author_identity_type,c.name as category_name FROM posts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=? AND p.status='published'").get(req.params.id);
    if (!p) return res.json({ code: 404, message: '帖子不存在' });
    let img=[],tag=[]; try{img=JSON.parse(p.images);}catch(e){} try{tag=JSON.parse(p.tags);}catch(e){}
    const comments = db.prepare("SELECT c.*,u.nickname as author_name,u.avatar as author_avatar FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.post_id=? AND c.status='published' ORDER BY c.floor_num ASC").all(req.params.id);
    res.json({ code: 200, data: { post: {...p,images:img,tags:tag,author_name:p.is_anonymous?'匿名用户':p.author_name,author_avatar:p.is_anonymous?'/img/default-avatar.png':p.author_avatar}, comments } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 博客分类公开API
app.get('/api/blog/categories', (req, res) => {
  try { res.json({ code: 200, data: { categories: db.prepare("SELECT * FROM categories WHERE status='active' ORDER BY sort_order").all() } }); } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// API路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/upload', require('./routes/upload'));

// 公开API
app.get('/api/announcements', (req, res) => {
  try {
    const now = new Date().toISOString();
    res.json({ code: 200, data: { announcements: db.prepare("SELECT id,title,content,type,position,is_pinned,show_popup FROM announcements WHERE status='published' AND (start_time IS NULL OR start_time<=?) AND (end_time IS NULL OR end_time>=?) ORDER BY is_pinned DESC,created_at DESC LIMIT 10").all(now, now) } });
  } catch (e) { res.json({ code: 200, data: { announcements: [] } }); }
});

app.get('/api/announcements/popup', (req, res) => {
  try {
    const now = new Date().toISOString();
    res.json({ code: 200, data: { announcement: db.prepare("SELECT id,title,content,type FROM announcements WHERE status='published' AND show_popup=1 AND (start_time IS NULL OR start_time<=?) AND (end_time IS NULL OR end_time>=?) ORDER BY is_pinned DESC,created_at DESC LIMIT 1").get(now, now) || null } });
  } catch (e) { res.json({ code: 200, data: { announcement: null } }); }
});

app.get('/api/music', (req, res) => {
  try { res.json({ code: 200, data: { music: db.prepare('SELECT * FROM music ORDER BY sort_order').all() } }); } catch (e) { res.json({ code: 200, data: { music: [] } }); }
});

app.get('/api/friend-links', (req, res) => {
  try { res.json({ code: 200, data: { links: db.prepare("SELECT * FROM friend_links WHERE status='active' ORDER BY sort_order").all() } }); } catch (e) { res.json({ code: 200, data: { links: [] } }); }
});

app.post('/api/feedback', (req, res) => {
  try {
    const { content, contact, contactType } = req.body;
    if (!content) return res.json({ code: 400, message: '请输入内容' });
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userId = null;
    if (token) try { const jwt = require('jsonwebtoken'); const d = jwt.verify(token, 'ys-blog-forum-secret-2026'); userId = d.id; } catch (e) {}
    db.prepare('INSERT INTO feedback (id,user_id,content,contact,contact_type) VALUES (?,?,?,?,?)').run(uuidv4(), userId, content, contact || '', contactType || 'other');
    res.json({ code: 200, message: '反馈已提交' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

app.get('/api/notifications/unread-count', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.json({ code: 200, data: { count: 0 } });
    const jwt = require('jsonwebtoken');
    const d = jwt.verify(token, 'ys-blog-forum-secret-2026');
    const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(d.id).c;
    res.json({ code: 200, data: { count } });
  } catch (e) { res.json({ code: 200, data: { count: 0 } }); }
});

// 维护预览API
app.get('/api/maintenance/preview', (req, res) => {
  try {
    const s = loadSettings();
    res.json({ title: s.maintenanceTitle, message: s.maintenanceMessage, bgColor: s.maintenanceBgColor, icon: s.maintenanceIcon, countdown: s.maintenanceCountdown, contact: s.maintenanceContact, customCss: s.maintenanceCustomCss, customHtml: s.maintenanceCustomHtml });
  } catch (e) { res.status(500).json({ error: '失败' }); }
});

// 页面路由
app.get('/admin/super', (req, res) => res.sendFile(path.join(__dirname, '../admin/super/index.html')));
app.get('/admin/super/', (req, res) => res.sendFile(path.join(__dirname, '../admin/super/index.html')));
app.get('/admin/admin', (req, res) => res.sendFile(path.join(__dirname, '../admin/admin/index.html')));
app.get('/admin/admin/', (req, res) => res.sendFile(path.join(__dirname, '../admin/admin/index.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, '../views/chat.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// 全局异常处理
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  setupSocket(io);
  server.listen(PORT, () => {
    console.log(`🌸 YS博客论坛系统运行在 http://localhost:${PORT}`);
    console.log(`🔧 超管后台: http://localhost:${PORT}/admin/super/`);
    console.log(`🔧 管理后台: http://localhost:${PORT}/admin/admin/`);
    console.log(`👤 默认超管: admin / admin123`);
  });
}).catch(e => { console.error('启动失败:', e); process.exit(1); });
