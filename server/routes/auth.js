const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { generateToken, authenticate } = require('../middleware/auth');
const { getSetting } = require('../settings');

const r = express.Router();

// 注册
r.post('/register', (req, res) => {
  try {
    const { username, password, nickname, email } = req.body;
    if (!username || !password || !nickname) return res.json({ code: 400, message: '请填写所有信息' });
    if (username.length < 3 || username.length > 20) return res.json({ code: 400, message: '用户名3-20字符' });
    if (password.length < 6) return res.json({ code: 400, message: '密码至少6位' });
    if (getSetting('allowRegister') !== 'true') return res.json({ code: 403, message: '暂不开放注册' });
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.json({ code: 400, message: '用户名已存在' });
    if (email && db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.json({ code: 400, message: '邮箱已注册' });
    const id = uuidv4(), points = parseInt(getSetting('registerPoints')) || 10;
    db.prepare("INSERT INTO users (id,username,password,nickname,email,points,role,status,ip) VALUES (?,?,?,?,?,?,'user','active',?)").run(id, username, bcrypt.hashSync(password, 10), nickname, email || null, points, req.ip);
    if (points > 0) db.prepare("INSERT INTO points_log (id,user_id,amount,reason,balance) VALUES (?,?,?,?,?)").run(uuidv4(), id, points, '注册奖励', points);
    const u = db.prepare('SELECT id,username,nickname,avatar,role,points,level,exp FROM users WHERE id=?').get(id);
    res.json({ code: 200, message: '注册成功', data: { token: generateToken(u), user: u } });
  } catch (e) { console.error(e); res.json({ code: 500, message: '注册失败' }); }
});

// 登录
r.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ code: 400, message: '请输入账号密码' });
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!u) {
      db.prepare("INSERT INTO login_logs (id,username,ip,status,reason) VALUES (?,?,?,?,?)").run(uuidv4(), username, req.ip, 'failed', '用户不存在');
      return res.json({ code: 401, message: '账号或密码错误' });
    }
    if (u.status === 'banned') return res.json({ code: 403, message: '账号已被封禁: ' + (u.ban_reason || '') });
    if (!bcrypt.compareSync(password, u.password)) {
      db.prepare("INSERT INTO login_logs (id,user_id,username,ip,status,reason) VALUES (?,?,?,?,?,?)").run(uuidv4(), u.id, username, req.ip, 'failed', '密码错误');
      return res.json({ code: 401, message: '账号或密码错误' });
    }
    db.prepare("UPDATE users SET last_login=datetime('now'),ip=? WHERE id=?").run(req.ip, u.id);
    db.prepare("INSERT INTO login_logs (id,user_id,username,ip,status) VALUES (?,?,?,?,?)").run(uuidv4(), u.id, username, req.ip, 'success');
    res.json({ code: 200, message: '登录成功', data: { token: generateToken(u), user: { id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar, role: u.role, bio: u.bio, points: u.points, level: u.level, exp: u.exp, verified_identity: u.verified_identity, identity_type: u.identity_type } } });
  } catch (e) { res.json({ code: 500, message: '登录失败' }); }
});

// 获取当前用户
r.get('/me', authenticate, (req, res) => {
  res.json({ code: 200, data: { user: req.user } });
});

// 更新资料
r.put('/profile', authenticate, (req, res) => {
  try {
    const { nickname, bio, avatar } = req.body;
    const f = [], v = [];
    if (nickname) { if (nickname.length > 20) return res.json({ code: 400, message: '昵称最长20字' }); f.push('nickname=?'); v.push(nickname); }
    if (bio !== undefined) { if (bio.length > 200) return res.json({ code: 400, message: '简介最长200字' }); f.push('bio=?'); v.push(bio); }
    if (avatar) { f.push('avatar=?'); v.push(avatar); }
    if (!f.length) return res.json({ code: 400, message: '无更新内容' });
    v.push(req.user.id);
    db.prepare(`UPDATE users SET ${f.join(',')} WHERE id=?`).run(...v);
    res.json({ code: 200, message: '已更新', data: { user: db.prepare('SELECT id,username,nickname,avatar,bio,role,points,level,exp,verified_identity,identity_type FROM users WHERE id=?').get(req.user.id) } });
  } catch (e) { res.json({ code: 500, message: '更新失败' }); }
});

// 修改密码
r.put('/password', authenticate, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.json({ code: 400, message: '请输入密码' });
    if (newPassword.length < 6) return res.json({ code: 400, message: '新密码至少6位' });
    if (!bcrypt.compareSync(oldPassword, db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id).password))
      return res.json({ code: 401, message: '旧密码错误' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
    res.json({ code: 200, message: '密码已修改' });
  } catch (e) { res.json({ code: 500, message: '修改失败' }); }
});

// 忘记密码
r.post('/forgot-password', (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) return res.json({ code: 400, message: '请输入用户名和新密码' });
    if (newPassword.length < 6) return res.json({ code: 400, message: '密码至少6位' });
    const u = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (!u) return res.json({ code: 404, message: '用户不存在' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), u.id);
    res.json({ code: 200, message: '密码已重置，请使用新密码登录' });
  } catch (e) { res.json({ code: 500, message: '重置失败' }); }
});

// 签到
r.post('/checkin', authenticate, (req, res) => {
  try {
    const uid = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const last = db.prepare('SELECT created_at FROM checkin_records WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(uid);
    if (last && last.created_at && last.created_at.startsWith(today)) return res.json({ code: 400, message: '今天已签到' });
    const points = parseInt(getSetting('checkinPoints')) || 5;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const isConsecutive = last && last.created_at && last.created_at.startsWith(yesterday);
    const streak = isConsecutive ? (req.user.checkin_streak || 0) + 1 : 1;
    const bonus = streak >= 7 ? points * 2 : streak >= 3 ? Math.floor(points * 1.5) : points;
    db.prepare('INSERT INTO checkin_records (id,user_id,points) VALUES (?,?,?)').run(uuidv4(), uid, bonus);
    db.prepare('UPDATE users SET points=points+?, exp=exp+?, checkin_streak=?, last_checkin=datetime("now") WHERE id=?').run(bonus, bonus, streak, uid);
    db.prepare('INSERT INTO points_log (id,user_id,amount,reason,balance) VALUES (?,?,?,?,?)').run(uuidv4(), uid, bonus, '每日签到', req.user.points + bonus);
    const user = db.prepare('SELECT points,level,exp,checkin_streak FROM users WHERE id=?').get(uid);
    res.json({ code: 200, message: `签到成功 +${bonus}积分${streak >= 3 ? ' (连续签到加成)' : ''}`, data: { points: user.points, streak: user.checkin_streak, bonus } });
  } catch (e) { res.json({ code: 500, message: '签到失败' }); }
});

// 获取用户公开信息
r.get('/user/:id', (req, res) => {
  try {
    const u = db.prepare("SELECT id,username,nickname,avatar,bio,points,level,exp,verified_identity,identity_type,created_at FROM users WHERE id=? AND status='active'").get(req.params.id);
    if (!u) return res.json({ code: 404, message: '用户不存在' });
    const posts = db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=? AND status='published'").get(req.params.id).c;
    const friends = db.prepare("SELECT COUNT(*) as c FROM friendships WHERE (user_id=? OR friend_id=?) AND status='accepted'").get(req.params.id, req.params.id).c;
    res.json({ code: 200, data: { user: { ...u, postCount: posts, friendCount: friends } } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 提交身份认证
r.post('/verify-identity', authenticate, (req, res) => {
  try {
    const { identityType, identityName, reason, proofUrl } = req.body;
    if (!identityType || !identityName) return res.json({ code: 400, message: '请填写认证类型和名称' });
    const pending = db.prepare("SELECT id FROM identity_verifications WHERE user_id=? AND status='pending'").get(req.user.id);
    if (pending) return res.json({ code: 400, message: '你已有待审核的申请' });
    db.prepare('INSERT INTO identity_verifications (id,user_id,identity_type,identity_name,reason,proof_url) VALUES (?,?,?,?,?,?)').run(uuidv4(), req.user.id, identityType, identityName, reason || '', proofUrl || '');
    res.json({ code: 200, message: '申请已提交，等待审核' });
  } catch (e) { res.json({ code: 500, message: '提交失败' }); }
});

// 获取我的认证状态
r.get('/my-identity', authenticate, (req, res) => {
  try {
    const verifications = db.prepare('SELECT * FROM identity_verifications WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
    res.json({ code: 200, data: { verifications } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 积分明细
r.get('/points-log', authenticate, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = 20;
    const total = db.prepare('SELECT COUNT(*) as c FROM points_log WHERE user_id=?').get(req.user.id).c;
    const logs = db.prepare('SELECT * FROM points_log WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.user.id, limit, (page - 1) * limit);
    res.json({ code: 200, data: { logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 排行榜
r.get('/ranking', (req, res) => {
  try {
    const type = req.query.type || 'points';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    let orderBy = 'points DESC';
    if (type === 'exp') orderBy = 'exp DESC';
    if (type === 'checkin') orderBy = 'checkin_streak DESC';
    const users = db.prepare(`SELECT id,username,nickname,avatar,points,level,exp,checkin_streak,verified_identity,identity_type FROM users WHERE status='active' ORDER BY ${orderBy} LIMIT ?`).all(limit);
    res.json({ code: 200, data: { users, type } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 好友系统
r.get('/friends', authenticate, (req, res) => {
  try {
    const status = req.query.status || 'accepted';
    const friends = db.prepare(`SELECT u.id,u.username,u.nickname,u.avatar,u.bio,u.verified_identity,u.identity_type,f.created_at as friend_since FROM friendships f JOIN users u ON (CASE WHEN f.user_id=? THEN f.friend_id ELSE f.user_id END) = u.id WHERE (f.user_id=? OR f.friend_id=?) AND f.status=?`).all(req.user.id, req.user.id, req.user.id, status);
    res.json({ code: 200, data: { friends } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

r.post('/friends/:id/add', authenticate, (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.json({ code: 400, message: '不能添加自己' });
    const target = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!target) return res.json({ code: 404, message: '用户不存在' });
    const existing = db.prepare("SELECT id,status FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").get(req.user.id, req.params.id, req.params.id, req.user.id);
    if (existing) {
      if (existing.status === 'accepted') return res.json({ code: 400, message: '已经是好友' });
      if (existing.status === 'pending') return res.json({ code: 400, message: '已发送申请' });
    }
    db.prepare('INSERT INTO friendships (id,user_id,friend_id,status) VALUES (?,?,?,?)').run(uuidv4(), req.user.id, req.params.id, 'pending');
    res.json({ code: 200, message: '申请已发送' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/friends/:id/accept', authenticate, (req, res) => {
  try {
    const f = db.prepare("SELECT id FROM friendships WHERE user_id=? AND friend_id=? AND status='pending'").get(req.params.id, req.user.id);
    if (!f) return res.json({ code: 404, message: '申请不存在' });
    db.prepare("UPDATE friendships SET status='accepted' WHERE id=?").run(f.id);
    res.json({ code: 200, message: '已接受' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.delete('/friends/:id', authenticate, (req, res) => {
  try {
    db.prepare("DELETE FROM friendships WHERE ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))").run(req.user.id, req.params.id, req.params.id, req.user.id);
    res.json({ code: 200, message: '已删除' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 搜索用户
r.get('/search-users', authenticate, (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ code: 200, data: { users: [] } });
    const users = db.prepare("SELECT id,username,nickname,avatar,bio FROM users WHERE status='active' AND (username LIKE ? OR nickname LIKE ?) LIMIT 20").all(`%${q}%`, `%${q}%`);
    res.json({ code: 200, data: { users } });
  } catch (e) { res.json({ code: 500, message: '搜索失败' }); }
});

module.exports = r;
