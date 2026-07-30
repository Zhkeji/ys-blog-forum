const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const r = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../public/uploads')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'audio/mpeg', 'audio/mp3', 'video/mp4'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('不支持的文件类型'), false);
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

r.post('/image', authenticate, upload.single('image'), (req, res) => {
  if (!req.file) return res.json({ code: 400, message: '请选择文件' });
  res.json({ code: 200, data: { url: `/uploads/${req.file.filename}` } });
});

r.post('/images', authenticate, upload.array('images', 9), (req, res) => {
  if (!req.files?.length) return res.json({ code: 400, message: '请选择文件' });
  res.json({ code: 200, data: { urls: req.files.map(f => `/uploads/${f.filename}`) } });
});

r.post('/file', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 400, message: '请选择文件' });
  res.json({ code: 200, data: { url: `/uploads/${req.file.filename}`, name: req.file.originalname } });
});

module.exports = r;
