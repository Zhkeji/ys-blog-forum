const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { getSetting } = require('../settings');

const r = express.Router();

// 敏感词过滤
function filterText(text) {
  try {
    const words = db.prepare('SELECT word,replacement,mode FROM sensitive_words').all();
    let t = text;
    words.forEach(w => {
      if (w.mode === 'block' && new RegExp(w.word, 'gi').test(t)) throw new Error('包含敏感词: ' + w.word);
      t = t.replace(new RegExp(w.word, 'gi'), w.replacement || '***');
      db.prepare('UPDATE sensitive_words SET hit_count=hit_count+1 WHERE word=?').run(w.word);
    });
    return t;
  } catch (e) { throw e; }
}

// 获取板块列表
r.get('/categories', (req, res) => {
  try {
    const cats = db.prepare("SELECT * FROM categories WHERE status='active' ORDER BY sort_order").all();
    res.json({ code: 200, data: { categories: cats } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 获取帖子列表
r.get('/', optionalAuth, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1, limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit, sort = req.query.sort || 'latest';
    const categoryId = req.query.category, search = req.query.search, tag = req.query.tag;
    const userId = req.query.userId;

    let w = "WHERE p.status = 'published' AND p.is_draft = 0", params = [];
    if (categoryId) { w += ' AND p.category_id=?'; params.push(categoryId); }
    if (search) { w += ' AND (p.title LIKE ? OR p.content LIKE ? OR p.tags LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (tag) { w += ' AND p.tags LIKE ?'; params.push(`%${tag}%`); }
    if (userId) { w += ' AND p.user_id=?'; params.push(userId); }

    let o = 'ORDER BY p.is_pinned DESC, p.created_at DESC';
    if (sort === 'hot') o = 'ORDER BY p.is_pinned DESC, p.likes DESC, p.views DESC';
    if (sort === 'views') o = 'ORDER BY p.is_pinned DESC, p.views DESC';
    if (sort === 'comments') o = 'ORDER BY p.is_pinned DESC, p.comments_count DESC';
    if (sort === 'essence') { w += ' AND p.is_essence=1'; o = 'ORDER BY p.created_at DESC'; }

    const total = db.prepare(`SELECT COUNT(*) as c FROM posts p ${w}`).get(...params).c;
    const posts = db.prepare(`SELECT p.*,u.nickname as author_name,u.avatar as author_avatar,u.id as author_id,u.level as author_level,u.role as author_role,u.verified_identity,u.identity_type as author_identity_type,c.name as category_name,c.icon as category_icon,c.color as category_color FROM posts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN categories c ON p.category_id=c.id ${w} ${o} LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({
      code: 200,
      data: {
        posts: posts.map(x => {
          let img = [], tag = [];
          try { img = JSON.parse(x.images); } catch (e) {}
          try { tag = JSON.parse(x.tags); } catch (e) {}
          const liked = req.user ? !!db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='post'").get(req.user.id, x.id) : false;
          const favorited = req.user ? !!db.prepare("SELECT id FROM favorites WHERE user_id=? AND post_id=?").get(req.user.id, x.id) : false;
          return { ...x, images: img, tags: tag, isLiked: liked, isFavorited: favorited, author_name: x.is_anonymous ? '匿名用户' : x.author_name, author_avatar: x.is_anonymous ? '/img/default-avatar.png' : x.author_avatar, author_id: x.is_anonymous ? null : x.author_id };
        }),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    });
  } catch (e) { console.error(e); res.json({ code: 500, message: '获取失败' }); }
});

// 获取单个帖子
r.get('/:id', optionalAuth, (req, res) => {
  try {
    db.prepare('UPDATE posts SET views=views+1 WHERE id=?').run(req.params.id);
    const p = db.prepare("SELECT p.*,u.nickname as author_name,u.avatar as author_avatar,u.id as author_id,u.level as author_level,u.role as author_role,u.verified_identity,u.identity_type as author_identity_type,c.name as category_name,c.icon as category_icon FROM posts p LEFT JOIN users u ON p.user_id=u.id LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=? AND p.status!='deleted'").get(req.params.id);
    if (!p) return res.json({ code: 404, message: '帖子不存在' });
    let img = [], tag = [];
    try { img = JSON.parse(p.images); } catch (e) {}
    try { tag = JSON.parse(p.tags); } catch (e) {}
    const liked = req.user ? !!db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='post'").get(req.user.id, p.id) : false;
    const favorited = req.user ? !!db.prepare("SELECT id FROM favorites WHERE user_id=? AND post_id=?").get(req.user.id, p.id) : false;

    // 获取评论（楼中楼）
    const comments = db.prepare("SELECT c.*,u.nickname as author_name,u.avatar as author_avatar,u.verified_identity,u.identity_type FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.post_id=? AND c.status='published' ORDER BY c.floor_num ASC").all(req.params.id);
    const commentMap = {};
    comments.forEach(c => { c.replies = []; commentMap[c.id] = c; });
    const rootComments = [];
    comments.forEach(c => {
      if (c.parent_id && commentMap[c.parent_id]) commentMap[c.parent_id].replies.push(c);
      else rootComments.push(c);
    });

    res.json({
      code: 200,
      data: {
        post: { ...p, images: img, tags: tag, isLiked: liked, isFavorited: favorited, author_name: p.is_anonymous ? '匿名用户' : p.author_name, author_avatar: p.is_anonymous ? '/img/default-avatar.png' : p.author_avatar, author_id: p.is_anonymous ? null : p.author_id },
        comments: rootComments
      }
    });
  } catch (e) { console.error(e); res.json({ code: 500, message: '获取失败' }); }
});

// 发帖
r.post('/', authenticate, (req, res) => {
  try {
    let { title, content, summary, coverImage, images, isAnonymous, tags, categoryId, isDraft } = req.body;
    if (!title || (!content && !isDraft)) return res.json({ code: 400, message: '请输入标题和内容' });
    try { title = filterText(title); content = filterText(content || ''); } catch (e) { return res.json({ code: 400, message: e.message }); }
    const st = isDraft ? 'draft' : (getSetting('postReview') === 'true' ? 'pending' : 'published');
    const id = uuidv4();
    const summaryText = summary || (content ? content.substring(0, 150).replace(/[#*`\n]/g, ' ').trim() : '');
    db.prepare("INSERT INTO posts (id,user_id,category_id,title,content,summary,cover_image,images,is_anonymous,tags,status,is_draft) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(id, req.user.id, categoryId || null, title, content || '', summaryText, coverImage || null, JSON.stringify(images || []), isAnonymous ? 1 : 0, JSON.stringify(tags || []), st, isDraft ? 1 : 0);
    if (!isDraft) {
      const pts = parseInt(getSetting('postPoints')) || 2;
      db.prepare('UPDATE users SET points=points+?, exp=exp+? WHERE id=?').run(pts, pts, req.user.id);
      db.prepare('INSERT INTO points_log (id,user_id,amount,reason) VALUES (?,?,?,?)').run(uuidv4(), req.user.id, pts, '发布帖子');
      if (categoryId) db.prepare('UPDATE categories SET post_count=post_count+1 WHERE id=?').run(categoryId);
    }
    res.json({ code: 200, message: isDraft ? '草稿已保存' : (st === 'pending' ? '发布成功，等待审核' : '发布成功'), data: { id, title, status: st } });
  } catch (e) { res.json({ code: 500, message: '发布失败' }); }
});

// 编辑帖子
r.put('/:id', authenticate, (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if (!p) return res.json({ code: 404, message: '帖子不存在' });
    if (p.user_id !== req.user.id && req.user.role === 'user') return res.json({ code: 403, message: '无权编辑' });
    const { title, content, summary, coverImage, images, tags, categoryId } = req.body;
    const f = [], v = [];
    if (title) { f.push('title=?'); v.push(title); }
    if (content) { f.push('content=?'); v.push(content); }
    if (summary) { f.push('summary=?'); v.push(summary); }
    if (coverImage) { f.push('cover_image=?'); v.push(coverImage); }
    if (images) { f.push('images=?'); v.push(JSON.stringify(images)); }
    if (tags) { f.push('tags=?'); v.push(JSON.stringify(tags)); }
    if (categoryId) { f.push('category_id=?'); v.push(categoryId); }
    f.push("updated_at=datetime('now')");
    v.push(req.params.id);
    db.prepare(`UPDATE posts SET ${f.join(',')} WHERE id=?`).run(...v);
    res.json({ code: 200, message: '已更新' });
  } catch (e) { res.json({ code: 500, message: '更新失败' }); }
});

// 删除帖子
r.delete('/:id', authenticate, (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
    if (!p) return res.json({ code: 404, message: '帖子不存在' });
    if (p.user_id !== req.user.id && req.user.role === 'user') return res.json({ code: 403, message: '无权删除' });
    db.prepare("UPDATE posts SET status='deleted' WHERE id=?").run(req.params.id);
    res.json({ code: 200, message: '已删除' });
  } catch (e) { res.json({ code: 500, message: '删除失败' }); }
});

// 点赞
r.post('/:id/like', authenticate, (req, res) => {
  try {
    const p = db.prepare('SELECT id,likes,user_id FROM posts WHERE id=?').get(req.params.id);
    if (!p) return res.json({ code: 404, message: '不存在' });
    const ex = db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='post'").get(req.user.id, req.params.id);
    if (ex) {
      db.prepare('DELETE FROM likes WHERE id=?').run(ex.id);
      db.prepare('UPDATE posts SET likes=MAX(0,likes-1) WHERE id=?').run(req.params.id);
      res.json({ code: 200, data: { liked: false, likes: p.likes - 1 } });
    } else {
      db.prepare("INSERT INTO likes (id,user_id,target_id,target_type) VALUES (?,?,?,'post')").run(uuidv4(), req.user.id, req.params.id);
      db.prepare('UPDATE posts SET likes=likes+1 WHERE id=?').run(req.params.id);
      res.json({ code: 200, data: { liked: true, likes: p.likes + 1 } });
    }
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 收藏
r.post('/:id/favorite', authenticate, (req, res) => {
  try {
    const ex = db.prepare("SELECT id FROM favorites WHERE user_id=? AND post_id=?").get(req.user.id, req.params.id);
    if (ex) {
      db.prepare('DELETE FROM favorites WHERE id=?').run(ex.id);
      db.prepare('UPDATE posts SET favorites=MAX(0,favorites-1) WHERE id=?').run(req.params.id);
      res.json({ code: 200, data: { favorited: false } });
    } else {
      db.prepare('INSERT INTO favorites (id,user_id,post_id) VALUES (?,?,?)').run(uuidv4(), req.user.id, req.params.id);
      db.prepare('UPDATE posts SET favorites=favorites+1 WHERE id=?').run(req.params.id);
      res.json({ code: 200, data: { favorited: true } });
    }
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 评论
r.post('/:id/comments', authenticate, (req, res) => {
  try {
    let { content, parentId, replyToId, replyToUserId } = req.body;
    if (!content?.trim()) return res.json({ code: 400, message: '请输入评论' });
    try { content = filterText(content); } catch (e) { return res.json({ code: 400, message: e.message }); }
    const p = db.prepare("SELECT id,user_id,title FROM posts WHERE id=? AND status='published'").get(req.params.id);
    if (!p) return res.json({ code: 404, message: '帖子不存在' });
    const floor = (db.prepare('SELECT MAX(floor_num) as m FROM comments WHERE post_id=?').get(req.params.id).m || 0) + 1;
    const id = uuidv4();
    db.prepare('INSERT INTO comments (id,post_id,user_id,parent_id,reply_to_id,reply_to_user_id,content,floor_num) VALUES (?,?,?,?,?,?,?,?)').run(id, req.params.id, req.user.id, parentId || null, replyToId || null, replyToUserId || null, content, floor);
    db.prepare('UPDATE posts SET comments_count=comments_count+1 WHERE id=?').run(req.params.id);
    const pts = parseInt(getSetting('commentPoints')) || 1;
    db.prepare('UPDATE users SET points=points+?,exp=exp+? WHERE id=?').run(pts, pts, req.user.id);
    const c = db.prepare('SELECT c.*,u.nickname as author_name,u.avatar as author_avatar FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.id=?').get(id);
    res.json({ code: 200, message: '评论成功', data: { comment: c } });
  } catch (e) { res.json({ code: 500, message: '评论失败' }); }
});

// 评论点赞
r.post('/comments/:id/like', authenticate, (req, res) => {
  try {
    const c = db.prepare('SELECT id,likes FROM comments WHERE id=?').get(req.params.id);
    if (!c) return res.json({ code: 404, message: '不存在' });
    const ex = db.prepare("SELECT id FROM likes WHERE user_id=? AND target_id=? AND target_type='comment'").get(req.user.id, req.params.id);
    if (ex) {
      db.prepare('DELETE FROM likes WHERE id=?').run(ex.id);
      db.prepare('UPDATE comments SET likes=MAX(0,likes-1) WHERE id=?').run(req.params.id);
      res.json({ code: 200, data: { liked: false, likes: c.likes - 1 } });
    } else {
      db.prepare("INSERT INTO likes (id,user_id,target_id,target_type) VALUES (?,?,?,'comment')").run(uuidv4(), req.user.id, req.params.id);
      db.prepare('UPDATE comments SET likes=likes+1 WHERE id=?').run(req.params.id);
      res.json({ code: 200, data: { liked: true, likes: c.likes + 1 } });
    }
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 举报
r.post('/:id/report', authenticate, (req, res) => {
  try {
    const { reason, description } = req.body;
    if (!reason) return res.json({ code: 400, message: '请填写原因' });
    if (db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_id=? AND status='pending'").get(req.user.id, req.params.id))
      return res.json({ code: 400, message: '已举报过' });
    db.prepare("INSERT INTO reports (id,reporter_id,target_id,target_type,reason,description) VALUES (?,?,?,'post',?,?)").run(uuidv4(), req.user.id, req.params.id, reason, description || '');
    res.json({ code: 200, message: '举报已提交' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

// 获取标签
r.get('/meta/tags', (req, res) => {
  try {
    const tc = {};
    db.prepare("SELECT tags FROM posts WHERE status='published'").all().forEach(x => { try { JSON.parse(x.tags).forEach(t => { tc[t] = (tc[t] || 0) + 1; }); } catch (e) {} });
    res.json({ code: 200, data: { tags: Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([n, c]) => ({ name: n, count: c })) } });
  } catch (e) { res.json({ code: 200, data: { tags: [] } }); }
});

// 保存草稿
r.post('/drafts', authenticate, (req, res) => {
  try {
    const { title, content, categoryId, tags } = req.body;
    const id = uuidv4();
    db.prepare('INSERT INTO drafts (id,user_id,title,content,category_id,tags) VALUES (?,?,?,?,?,?)').run(id, req.user.id, title || '', content || '', categoryId || null, JSON.stringify(tags || []));
    res.json({ code: 200, message: '草稿已保存', data: { id } });
  } catch (e) { res.json({ code: 500, message: '保存失败' }); }
});

// 获取我的草稿
r.get('/drafts/my', authenticate, (req, res) => {
  try {
    const drafts = db.prepare('SELECT * FROM drafts WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id);
    res.json({ code: 200, data: { drafts } });
  } catch (e) { res.json({ code: 500, message: '获取失败' }); }
});

// 转发
r.post('/:id/share', authenticate, (req, res) => {
  try {
    db.prepare('UPDATE posts SET shares=shares+1 WHERE id=?').run(req.params.id);
    res.json({ code: 200, message: '转发成功' });
  } catch (e) { res.json({ code: 500, message: '失败' }); }
});

module.exports = r;
