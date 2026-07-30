const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { authenticate } = require('../middleware/auth');

const r = express.Router();

r.get('/conversations', authenticate, (req, res) => {
  try {
    const convs = db.prepare(`SELECT c.*,CASE WHEN c.user1_id=? THEN u2.nickname ELSE u1.nickname END as other_name,CASE WHEN c.user1_id=? THEN u2.avatar ELSE u1.avatar END as other_avatar,CASE WHEN c.user1_id=? THEN u2.id ELSE u1.id END as other_id,(SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.receiver_id=? AND m.is_read=0) as unread_count FROM conversations c LEFT JOIN users u1 ON c.user1_id=u1.id LEFT JOIN users u2 ON c.user2_id=u2.id WHERE c.user1_id=? OR c.user2_id=? ORDER BY c.last_message_at DESC`).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
    res.json({ code: 200, data: { conversations: convs } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/conversations', authenticate, (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || userId === req.user.id) return res.json({ code: 400, message: '无效' });
    const o = db.prepare('SELECT id,nickname,avatar FROM users WHERE id=?').get(userId);
    if (!o) return res.json({ code: 404, message: '用户不存在' });
    let c = db.prepare('SELECT * FROM conversations WHERE (user1_id=? AND user2_id=?) OR (user1_id=? AND user2_id=?)').get(req.user.id, userId, userId, req.user.id);
    if (!c) { const id = uuidv4(); db.prepare('INSERT INTO conversations (id,user1_id,user2_id) VALUES (?,?,?)').run(id, req.user.id, userId); c = db.prepare('SELECT * FROM conversations WHERE id=?').get(id); }
    res.json({ code: 200, data: { conversation: { ...c, other_name: o.nickname, other_avatar: o.avatar, other_id: o.id } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.get('/conversations/:id/messages', authenticate, (req, res) => {
  try {
    const c = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
    if (!c) return res.json({ code: 404, message: '不存在' });
    if (c.user1_id !== req.user.id && c.user2_id !== req.user.id && req.user.role !== 'super_admin') return res.json({ code: 403, message: '无权' });
    const page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const total = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id=?').get(req.params.id).c;
    db.prepare('UPDATE messages SET is_read=1 WHERE conversation_id=? AND receiver_id=? AND is_read=0').run(req.params.id, req.user.id);
    const msgs = db.prepare('SELECT m.*,u.nickname as sender_name,u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.conversation_id=? ORDER BY m.created_at DESC LIMIT ? OFFSET ?').all(req.params.id, limit, (page - 1) * limit).reverse();
    res.json({ code: 200, data: { messages: msgs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.post('/conversations/:id/messages', authenticate, (req, res) => {
  try {
    const { content, type = 'text' } = req.body;
    if (!content) return res.json({ code: 400, message: '请输入内容' });
    const c = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
    if (!c) return res.json({ code: 404, message: '不存在' });
    if (c.user1_id !== req.user.id && c.user2_id !== req.user.id) return res.json({ code: 403, message: '无权' });
    const rid = c.user1_id === req.user.id ? c.user2_id : c.user1_id, id = uuidv4();
    db.prepare('INSERT INTO messages (id,conversation_id,sender_id,receiver_id,content,type) VALUES (?,?,?,?,?,?)').run(id, req.params.id, req.user.id, rid, content, type);
    db.prepare("UPDATE conversations SET last_message=?,last_message_at=datetime('now') WHERE id=?").run(content.substring(0, 100), req.params.id);
    const msg = db.prepare('SELECT m.*,u.nickname as sender_name,u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.id=?').get(id);
    const io = req.app.get('io');
    if (io) io.to(`user_${rid}`).emit('new_message', { ...msg, conversation_id: req.params.id });
    res.json({ code: 200, data: { message: msg } });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 超管介入
r.post('/conversations/:id/intervene', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'super_admin') return res.json({ code: 403, message: '仅超管' });
    const { content } = req.body;
    if (!content) return res.json({ code: 400, message: '请输入内容' });
    const c = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.id);
    if (!c) return res.json({ code: 404, message: '不存在' });
    const id = uuidv4();
    db.prepare("INSERT INTO messages (id,conversation_id,sender_id,receiver_id,content,type) VALUES (?,?,?,?,?,'system')").run(id, req.params.id, req.user.id, c.user1_id, `[管理员介入] ${content}`);
    db.prepare("UPDATE conversations SET last_message=?,last_message_at=datetime('now') WHERE id=?").run(`[管理员] ${content.substring(0, 80)}`, req.params.id);
    const msg = db.prepare('SELECT m.*,u.nickname as sender_name FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.id=?').get(id);
    const io = req.app.get('io');
    if (io) { io.to(`user_${c.user1_id}`).emit('new_message', { ...msg, conversation_id: req.params.id }); io.to(`user_${c.user2_id}`).emit('new_message', { ...msg, conversation_id: req.params.id }); }
    res.json({ code: 200, message: '已介入' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

r.get('/unread', authenticate, (req, res) => {
  try { res.json({ code: 200, data: { count: db.prepare('SELECT COUNT(*) as c FROM messages WHERE receiver_id=? AND is_read=0').get(req.user.id).c } }); } catch (e) { res.json({ code: 200, data: { count: 0 } }); }
});

module.exports = r;
