const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { authenticate, requireAdmin, requirePermission, requireSuperAdmin } = require('../middleware/auth');
const { loadSettings, setSettings } = require('../settings');

const r = express.Router();
r.use(authenticate, requireAdmin);

// 仪表盘统计
r.get('/stats', (req, res) => {
  try {
    const stats = {
      totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      totalPosts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE status!='deleted'").get().c,
      totalComments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE status!='deleted'").get().c,
      todayPosts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE date(created_at)=date('now')").get().c,
      todayUsers: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now')").get().c,
      pendingReview: db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='pending'").get().c,
      pendingReports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status='pending'").get().c,
      onlineUsers: 0
    };
    // 七日趋势
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      trend.push({
        date,
        posts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE date(created_at)=?").get(date).c,
        users: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=?").get(date).c,
        comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE date(created_at)=?").get(date).c
      });
    }
    const recentPosts = db.prepare("SELECT p.id,p.title,p.created_at,p.status,p.views,p.likes,u.nickname FROM posts p LEFT JOIN users u ON p.user_id=u.id ORDER BY p.created_at DESC LIMIT 10").all();
    res.json({ code: 200, data: { stats, trend, recentPosts } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 用户管理
r.get('/users', requirePermission('users'), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const search = req.query.search, role = req.query.role, status = req.query.status;
    let w = 'WHERE 1=1', p = [];
    if (search) { w += ' AND (username LIKE ? OR nickname LIKE ? OR email LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (role) { w += ' AND role=?'; p.push(role); }
    if (status) { w += ' AND status=?'; p.push(status); }
    const total = db.prepare(`SELECT COUNT(*) as c FROM users ${w}`).get(...p).c;
    const users = db.prepare(`SELECT id,username,nickname,avatar,email,role,status,points,level,exp,ip,created_at,last_login FROM users ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p, limit, (page - 1) * limit);
    res.json({ code: 200, data: { users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 帖子管理
r.get('/posts', requirePermission('posts'), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const status = req.query.status, search = req.query.search;
    let w = "WHERE p.status!='deleted'", p = [];
    if (status) { w += ' AND p.status=?'; p.push(status); }
    if (search) { w += ' AND (p.title LIKE ? OR p.content LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
    const total = db.prepare(`SELECT COUNT(*) as c FROM posts p ${w}`).get(...p).c;
    const posts = db.prepare(`SELECT p.*,u.nickname as author_name FROM posts p LEFT JOIN users u ON p.user_id=u.id ${w} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...p, limit, (page - 1) * limit);
    res.json({ code: 200, data: { posts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/posts/:id/status', requirePermission('posts'), (req, res) => {
  try { db.prepare('UPDATE posts SET status=? WHERE id=?').run(req.body.status, req.params.id); res.json({ code: 200, message: '已更新' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/posts/:id/pin', requireSuperAdmin, (req, res) => {
  try { db.prepare('UPDATE posts SET is_pinned=? WHERE id=?').run(req.body.pinned ? 1 : 0, req.params.id); res.json({ code: 200, message: req.body.pinned ? '已置顶' : '已取消' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/posts/:id/essence', requirePermission('posts'), (req, res) => {
  try { db.prepare('UPDATE posts SET is_essence=? WHERE id=?').run(req.body.essence ? 1 : 0, req.params.id); res.json({ code: 200, message: req.body.essence ? '已加精' : '已取消' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/posts/:id', requirePermission('posts'), (req, res) => {
  try { db.prepare("UPDATE posts SET status='deleted' WHERE id=?").run(req.params.id); res.json({ code: 200, message: '已删除' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 评论管理
r.get('/comments', requirePermission('comments'), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = 20;
    const total = db.prepare("SELECT COUNT(*) as c FROM comments WHERE status!='deleted'").get().c;
    const comments = db.prepare("SELECT c.*,u.nickname as author_name,p.title as post_title FROM comments c LEFT JOIN users u ON c.user_id=u.id LEFT JOIN posts p ON c.post_id=p.id WHERE c.status!='deleted' ORDER BY c.created_at DESC LIMIT ? OFFSET ?").all(limit, (page - 1) * limit);
    res.json({ code: 200, data: { comments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/comments/:id', requirePermission('comments'), (req, res) => {
  try {
    db.prepare("UPDATE comments SET status='deleted' WHERE id=?").run(req.params.id);
    db.prepare('UPDATE posts SET comments_count=MAX(0,comments_count-1) WHERE id=(SELECT post_id FROM comments WHERE id=?)').run(req.params.id);
    res.json({ code: 200, message: '已删除' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 举报管理
r.get('/reports', requirePermission('reports'), (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const reports = db.prepare(`SELECT r.*,u.nickname as reporter_name FROM reports r LEFT JOIN users u ON r.reporter_id=u.id WHERE r.status=? ORDER BY r.created_at DESC`).all(status);
    res.json({ code: 200, data: { reports } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/reports/:id', requirePermission('reports'), (req, res) => {
  try {
    const { status, adminNote } = req.body;
    db.prepare("UPDATE reports SET status=?,admin_note=?,handled_by=?,handled_at=datetime('now') WHERE id=?").run(status, adminNote || '', req.user.id, req.params.id);
    res.json({ code: 200, message: '已处理' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 板块管理
r.get('/categories', requirePermission('categories'), (req, res) => {
  try { res.json({ code: 200, data: { categories: db.prepare('SELECT * FROM categories ORDER BY sort_order').all() } }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/categories', requireSuperAdmin, (req, res) => {
  try {
    const { name, description, icon, color } = req.body;
    if (!name) return res.json({ code: 400, message: '请输入名称' });
    const id = uuidv4();
    db.prepare('INSERT INTO categories (id,name,description,icon,color) VALUES (?,?,?,?,?)').run(id, name, description || '', icon || '📝', color || '#4a90d9');
    res.json({ code: 200, message: '已创建', data: { id } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/categories/:id', requireSuperAdmin, (req, res) => {
  try {
    const { name, description, icon, color, status } = req.body;
    const f = [], v = [];
    if (name) { f.push('name=?'); v.push(name); }
    if (description !== undefined) { f.push('description=?'); v.push(description); }
    if (icon) { f.push('icon=?'); v.push(icon); }
    if (color) { f.push('color=?'); v.push(color); }
    if (status) { f.push('status=?'); v.push(status); }
    if (f.length) { v.push(req.params.id); db.prepare(`UPDATE categories SET ${f.join(',')} WHERE id=?`).run(...v); }
    res.json({ code: 200, message: '已更新' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/categories/:id', requireSuperAdmin, (req, res) => {
  try { db.prepare("UPDATE categories SET status='deleted' WHERE id=?").run(req.params.id); res.json({ code: 200, message: '已删除' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 敏感词管理
r.get('/sensitive-words', requirePermission('sensitive'), (req, res) => {
  try { res.json({ code: 200, data: { words: db.prepare('SELECT * FROM sensitive_words ORDER BY hit_count DESC').all() } }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/sensitive-words', requirePermission('sensitive'), (req, res) => {
  try {
    const { word, replacement, mode } = req.body;
    if (!word) return res.json({ code: 400, message: '请输入敏感词' });
    if (db.prepare('SELECT id FROM sensitive_words WHERE word=?').get(word)) return res.json({ code: 400, message: '已存在' });
    db.prepare('INSERT INTO sensitive_words (id,word,replacement,mode) VALUES (?,?,?,?)').run(uuidv4(), word, replacement || '***', mode || 'replace');
    res.json({ code: 200, message: '已添加' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/sensitive-words/:id', requirePermission('sensitive'), (req, res) => {
  try { db.prepare('DELETE FROM sensitive_words WHERE id=?').run(req.params.id); res.json({ code: 200, message: '已删除' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 公告管理
r.get('/announcements', requirePermission('announcements'), (req, res) => {
  try { res.json({ code: 200, data: { announcements: db.prepare('SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC').all() } }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/announcements', requirePermission('announcements'), (req, res) => {
  try {
    const { title, content, type, position, is_pinned, show_popup, start_time, end_time } = req.body;
    if (!title || !content) return res.json({ code: 400, message: '请填写完整' });
    const id = uuidv4();
    db.prepare("INSERT INTO announcements (id,title,content,type,position,is_pinned,show_popup,start_time,end_time,status) VALUES (?,?,?,?,?,?,?,?,?,'published')").run(id, title, content, type || 'info', position || 'top', is_pinned ? 1 : 0, show_popup ? 1 : 0, start_time || null, end_time || null);
    res.json({ code: 200, message: '已发布', data: { id } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/announcements/:id', requirePermission('announcements'), (req, res) => {
  try {
    const { title, content, type, position, is_pinned, show_popup, status } = req.body;
    const f = [], v = [];
    if (title) { f.push('title=?'); v.push(title); }
    if (content) { f.push('content=?'); v.push(content); }
    if (type) { f.push('type=?'); v.push(type); }
    if (position) { f.push('position=?'); v.push(position); }
    if (is_pinned !== undefined) { f.push('is_pinned=?'); v.push(is_pinned ? 1 : 0); }
    if (show_popup !== undefined) { f.push('show_popup=?'); v.push(show_popup ? 1 : 0); }
    if (status) { f.push('status=?'); v.push(status); }
    if (f.length) { v.push(req.params.id); db.prepare(`UPDATE announcements SET ${f.join(',')} WHERE id=?`).run(...v); }
    res.json({ code: 200, message: '已更新' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/announcements/:id', requirePermission('announcements'), (req, res) => {
  try { db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id); res.json({ code: 200, message: '已删除' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 音乐管理
r.get('/music', requirePermission('music'), (req, res) => {
  try { res.json({ code: 200, data: { music: db.prepare('SELECT * FROM music ORDER BY sort_order').all() } }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/music', requireSuperAdmin, (req, res) => {
  try {
    const { title, artist, url, cover } = req.body;
    if (!title || !url) return res.json({ code: 400, message: '请填写完整' });
    db.prepare('INSERT INTO music (id,title,artist,url,cover) VALUES (?,?,?,?,?)').run(uuidv4(), title, artist || '', url, cover || '');
    res.json({ code: 200, message: '已添加' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/music/:id', requireSuperAdmin, (req, res) => {
  try { db.prepare('DELETE FROM music WHERE id=?').run(req.params.id); res.json({ code: 200, message: '已删除' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 友链管理
r.get('/friend-links', requirePermission('links'), (req, res) => {
  try { res.json({ code: 200, data: { links: db.prepare('SELECT * FROM friend_links ORDER BY sort_order').all() } }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/friend-links', requireSuperAdmin, (req, res) => {
  try {
    const { name, url, logo, description } = req.body;
    if (!name || !url) return res.json({ code: 400, message: '请填写完整' });
    db.prepare('INSERT INTO friend_links (id,name,url,logo,description) VALUES (?,?,?,?,?)').run(uuidv4(), name, url, logo || '', description || '');
    res.json({ code: 200, message: '已添加' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/friend-links/:id', requireSuperAdmin, (req, res) => {
  try { db.prepare('DELETE FROM friend_links WHERE id=?').run(req.params.id); res.json({ code: 200, message: '已删除' }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 反馈管理
r.get('/feedback', requirePermission('feedback'), (req, res) => {
  try {
    const fb = db.prepare("SELECT f.*,u.nickname FROM feedback f LEFT JOIN users u ON f.user_id=u.id ORDER BY f.created_at DESC").all();
    res.json({ code: 200, data: { feedback: fb } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/feedback/:id', requirePermission('feedback'), (req, res) => {
  try {
    const { status, reply } = req.body;
    const f = [], v = [];
    if (status) { f.push('status=?'); v.push(status); }
    if (reply) { f.push('reply=?'); v.push(reply); f.push("replied_by=?"); v.push(req.user.id); f.push("replied_at=datetime('now')"); }
    if (f.length) { v.push(req.params.id); db.prepare(`UPDATE feedback SET ${f.join(',')} WHERE id=?`).run(...v); }
    res.json({ code: 200, message: '已处理' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 用户操作
r.put('/users/:id/status', requirePermission('users'), (req, res) => {
  try {
    const { status, reason } = req.body;
    if (req.params.id === req.user.id) return res.json({ code: 400, message: '不能操作自己' });
    const f = ['status=?'], v = [status];
    if (reason) { f.push('ban_reason=?'); v.push(reason); }
    v.push(req.params.id);
    db.prepare(`UPDATE users SET ${f.join(',')} WHERE id=?`).run(...v);
    res.json({ code: 200, message: status === 'banned' ? '已封禁' : '已解封' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/users/:id/points', requireSuperAdmin, (req, res) => {
  try {
    const { points, reason } = req.body;
    db.prepare('UPDATE users SET points=? WHERE id=?').run(points, req.params.id);
    db.prepare('INSERT INTO points_log (id,user_id,amount,reason) VALUES (?,?,?,?)').run(uuidv4(), req.params.id, points - (db.prepare('SELECT points FROM users WHERE id=?').get(req.params.id).points || 0), reason || '管理员调整');
    res.json({ code: 200, message: '已更新' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/users/:id/reset-password', requireSuperAdmin, (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.json({ code: 400, message: '密码至少6位' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.params.id);
    res.json({ code: 200, message: '密码已重置' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 添加管理员
r.post('/users/admin', requireSuperAdmin, (req, res) => {
  try {
    const { username, password, nickname } = req.body;
    if (!username || !password || !nickname) return res.json({ code: 400, message: '请填写完整' });
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.json({ code: 400, message: '用户名已存在' });
    const id = uuidv4();
    db.prepare("INSERT INTO users (id,username,password,nickname,role,status) VALUES (?,?,?,?,?,'admin','active')").run(id, username, bcrypt.hashSync(password, 10), nickname);
    res.json({ code: 200, message: '已添加', data: { id } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/users/:id/role', requireSuperAdmin, (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'super_admin'].includes(role)) return res.json({ code: 400, message: '无效' });
    if (req.params.id === req.user.id) return res.json({ code: 400, message: '不能改自己' });
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
    res.json({ code: 200, message: '已更新' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 管理员权限
r.get('/admins/:id/permissions', requireSuperAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, nickname, admin_permissions FROM users WHERE id = ? AND role = ?').get(req.params.id, 'admin');
    if (!user) return res.json({ code: 404, message: '管理员不存在' });
    let perms = [];
    try { perms = JSON.parse(user.admin_permissions || '[]'); } catch (e) {}
    res.json({ code: 200, data: { permissions: perms } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/admins/:id/permissions', requireSuperAdmin, (req, res) => {
  try {
    const { permissions } = req.body;
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user || user.role !== 'admin') return res.json({ code: 400, message: '只能设置管理员权限' });
    db.prepare('UPDATE users SET admin_permissions = ? WHERE id = ?').run(JSON.stringify(permissions), req.params.id);
    res.json({ code: 200, message: '权限已更新' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.get('/admins/list', requireSuperAdmin, (req, res) => {
  try {
    const admins = db.prepare("SELECT id, username, nickname, avatar, admin_permissions, created_at, last_login FROM users WHERE role = 'admin' ORDER BY created_at DESC").all();
    res.json({ code: 200, data: { admins: admins.map(a => { let p = []; try { p = JSON.parse(a.admin_permissions || '[]'); } catch(e) {} return { ...a, permissions: p }; }) } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 身份认证管理
r.get('/verifications', requirePermission('users'), (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const verifications = db.prepare(`SELECT v.*,u.username,u.nickname FROM identity_verifications v LEFT JOIN users u ON v.user_id=u.id WHERE v.status=? ORDER BY v.created_at DESC`).all(status);
    res.json({ code: 200, data: { verifications } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/verifications/:id', requirePermission('users'), (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.json({ code: 400, message: '无效状态' });
    const v = db.prepare('SELECT * FROM identity_verifications WHERE id=?').get(req.params.id);
    if (!v) return res.json({ code: 404, message: '申请不存在' });
    db.prepare("UPDATE identity_verifications SET status=?,admin_note=?,reviewed_by=?,reviewed_at=datetime('now') WHERE id=?").run(status, adminNote || '', req.user.id, req.params.id);
    if (status === 'approved') {
      db.prepare('UPDATE users SET verified_identity=?,identity_type=? WHERE id=?').run(v.identity_name, v.identity_type, v.user_id);
    }
    res.json({ code: 200, message: status === 'approved' ? '已通过' : '已驳回' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 网站设置
r.get('/settings', (req, res) => {
  try { res.json({ code: 200, data: { settings: loadSettings() } }); } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/settings', requireSuperAdmin, (req, res) => {
  try {
    const allowed = ['siteName', 'siteDescription', 'siteLogo', 'siteFavicon', 'siteFooter', 'allowRegister', 'postReview', 'checkinPoints', 'registerPoints', 'postPoints', 'commentPoints', 'likePoints', 'maxUploadSize', 'allowedFileTypes', 'carouselAutoPlay', 'carouselInterval', 'enableMusic', 'enableFeedback', 'defaultTheme'];
    const f = {};
    for (const [k, v] of Object.entries(req.body)) if (allowed.includes(k)) f[k] = v;
    if (Object.keys(f).length) setSettings(f);
    res.json({ code: 200, message: '已保存' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 维护系统
r.get('/maintenance', requireSuperAdmin, (req, res) => {
  try {
    const s = loadSettings();
    res.json({ code: 200, data: { maintenance: { mode: s.maintenanceMode === 'true', title: s.maintenanceTitle, message: s.maintenanceMessage, bgColor: s.maintenanceBgColor, icon: s.maintenanceIcon, countdown: s.maintenanceCountdown, contact: s.maintenanceContact, customCss: s.maintenanceCustomCss, customHtml: s.maintenanceCustomHtml } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.put('/maintenance', requireSuperAdmin, (req, res) => {
  try {
    const { title, message, bgColor, icon, countdown, contact, customCss, customHtml } = req.body;
    const u = {};
    if (title !== undefined) u.maintenanceTitle = title;
    if (message !== undefined) u.maintenanceMessage = message;
    if (bgColor !== undefined) u.maintenanceBgColor = bgColor;
    if (icon !== undefined) u.maintenanceIcon = icon;
    if (countdown !== undefined) u.maintenanceCountdown = countdown;
    if (contact !== undefined) u.maintenanceContact = contact;
    if (customCss !== undefined) u.maintenanceCustomCss = customCss;
    if (customHtml !== undefined) u.maintenanceCustomHtml = customHtml;
    setSettings(u);
    res.json({ code: 200, message: '已保存' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/maintenance/toggle', requireSuperAdmin, (req, res) => {
  try {
    const s = loadSettings(), n = s.maintenanceMode !== 'true';
    setSettings({ maintenanceMode: String(n) });
    res.json({ code: 200, message: n ? '维护已开启' : '维护已关闭', data: { mode: n } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 日志
r.get('/logs/login', requireSuperAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = 50;
    const total = db.prepare('SELECT COUNT(*) as c FROM login_logs').get().c;
    const logs = db.prepare('SELECT * FROM login_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, (page - 1) * limit);
    res.json({ code: 200, data: { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.get('/logs/operation', requireSuperAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = 50;
    const total = db.prepare('SELECT COUNT(*) as c FROM operation_logs').get().c;
    const logs = db.prepare('SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, (page - 1) * limit);
    res.json({ code: 200, data: { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

module.exports = r;
