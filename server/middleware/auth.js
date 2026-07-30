const jwt = require('jsonwebtoken');
const { db } = require('../database');
const SECRET = 'ys-blog-forum-secret-2026';

function generateToken(u) {
  return jwt.sign({ id: u.id, username: u.username, role: u.role }, SECRET, { expiresIn: '7d' });
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token) return res.status(401).json({ code: 401, message: '请先登录' });
  try {
    const d = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT id,username,nickname,avatar,role,status,bio,points,level,exp,admin_permissions,verified_identity,identity_type FROM users WHERE id=?').get(d.id);
    if (!u) return res.status(401).json({ code: 401, message: '用户不存在' });
    if (u.status === 'banned') return res.status(403).json({ code: 403, message: '账号已被封禁' });
    let perms = [];
    try { perms = JSON.parse(u.admin_permissions || '[]'); } catch (e) {}
    u.permissions = perms;
    req.user = u;
    next();
  } catch (e) { return res.status(401).json({ code: 401, message: '登录已过期' }); }
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) try {
    const d = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT id,username,nickname,avatar,role,status,admin_permissions,verified_identity,identity_type FROM users WHERE id=?').get(d.id);
    if (u && u.status !== 'banned') {
      let perms = [];
      try { perms = JSON.parse(u.admin_permissions || '[]'); } catch (e) {}
      u.permissions = perms;
      req.user = u;
    }
  } catch (e) {}
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role))
    return res.status(403).json({ code: 403, message: '需要管理员权限' });
  next();
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user || !['admin', 'super_admin'].includes(req.user.role))
      return res.status(403).json({ code: 403, message: '需要管理员权限' });
    if (req.user.role === 'super_admin') return next();
    if (req.user.permissions && req.user.permissions.includes(perm)) return next();
    return res.status(403).json({ code: 403, message: `没有${perm}权限` });
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin')
    return res.status(403).json({ code: 403, message: '需要超级管理员权限' });
  next();
}

module.exports = { generateToken, authenticate, optionalAuth, requireAdmin, requirePermission, requireSuperAdmin, SECRET };
