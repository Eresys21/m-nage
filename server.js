// Serveur de l'application M-nage : API + envoi des rappels (Web Push).
process.env.TZ = process.env.TZ || 'Europe/Paris';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Stockage (fichier JSON) ----------
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], tasks: [], completions: [], subscriptions: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

let db = loadDb();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const newId = () => crypto.randomUUID();

// ---------- Clés VAPID pour les notifications ----------
let vapid;
if (fs.existsSync(VAPID_FILE)) {
  vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2));
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  vapid.publicKey,
  vapid.privateKey
);

async function notifyUsers(userIds, payload) {
  const targets = db.subscriptions.filter((s) => userIds.includes(s.userId));
  const expired = [];
  await Promise.all(
    targets.map((s) =>
      webpush.sendNotification(s.subscription, JSON.stringify(payload)).catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) expired.push(s.subscription.endpoint);
        else console.error('Erreur push :', err.statusCode || err.message);
      })
    )
  );
  if (expired.length) {
    db.subscriptions = db.subscriptions.filter((s) => !expired.includes(s.subscription.endpoint));
    saveDb();
  }
}

// ---------- Utilitaires ----------
function weekStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - day + offset * 7);
  return d;
}

function nextDue(dueAt, recurrence) {
  const step = recurrence === 'daily' ? 1 : recurrence === 'weekly' ? 7 : 0;
  if (!step) return null;
  const d = new Date(dueAt);
  const now = new Date();
  do {
    d.setDate(d.getDate() + step);
  } while (d <= now);
  return d.toISOString();
}

// ---------- API ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/vapid-public-key', (req, res) => res.json({ key: vapid.publicKey }));

// Utilisateurs
app.get('/api/users', (req, res) => res.json(db.users));

app.post('/api/users', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Prénom requis' });
  if (db.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Ce prénom existe déjà' });
  }
  const user = { id: newId(), name };
  db.users.push(user);
  saveDb();
  res.status(201).json(user);
});

app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  db.users = db.users.filter((u) => u.id !== id);
  db.subscriptions = db.subscriptions.filter((s) => s.userId !== id);
  db.tasks.forEach((t) => {
    if (t.assigneeId === id) t.assigneeId = null;
  });
  saveDb();
  res.status(204).end();
});

// Tâches
app.get('/api/tasks', (req, res) => res.json(db.tasks));

app.post('/api/tasks', (req, res) => {
  const { title, points, assigneeId, dueAt, recurrence } = req.body;
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return res.status(400).json({ error: 'Titre requis' });
  const pts = parseInt(points, 10);
  if (!Number.isInteger(pts) || pts < 1) return res.status(400).json({ error: 'Points invalides' });
  if (assigneeId && !db.users.some((u) => u.id === assigneeId)) {
    return res.status(400).json({ error: 'Utilisateur inconnu' });
  }
  if (dueAt && isNaN(Date.parse(dueAt))) return res.status(400).json({ error: 'Date invalide' });
  const task = {
    id: newId(),
    title: cleanTitle,
    points: pts,
    assigneeId: assigneeId || null,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    recurrence: ['daily', 'weekly'].includes(recurrence) ? recurrence : 'none',
    reminded: false,
  };
  db.tasks.push(task);
  saveDb();
  res.status(201).json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  db.tasks = db.tasks.filter((t) => t.id !== req.params.id);
  saveDb();
  res.status(204).end();
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const task = db.tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Tâche introuvable' });
  const user = db.users.find((u) => u.id === req.body.userId);
  if (!user) return res.status(400).json({ error: 'Utilisateur inconnu' });

  db.completions.push({
    id: newId(),
    taskId: task.id,
    title: task.title,
    userId: user.id,
    points: task.points,
    at: new Date().toISOString(),
  });

  if (task.recurrence !== 'none' && task.dueAt) {
    task.dueAt = nextDue(task.dueAt, task.recurrence);
    task.reminded = false;
  } else if (task.recurrence === 'none') {
    db.tasks = db.tasks.filter((t) => t.id !== task.id);
  }
  saveDb();
  res.json({ ok: true, points: task.points });
});

// Classement hebdomadaire (offset=0 : semaine en cours, -1 : semaine précédente…)
app.get('/api/leaderboard', (req, res) => {
  const offset = parseInt(req.query.offset, 10) || 0;
  const start = weekStart(offset);
  const end = weekStart(offset + 1);
  const scores = db.users.map((u) => ({ userId: u.id, name: u.name, points: 0, tasks: 0 }));
  for (const c of db.completions) {
    const at = new Date(c.at);
    if (at < start || at >= end) continue;
    const s = scores.find((x) => x.userId === c.userId);
    if (s) {
      s.points += c.points;
      s.tasks += 1;
    }
  }
  scores.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  res.json({ start: start.toISOString(), end: end.toISOString(), scores });
});

// Historique récent
app.get('/api/completions', (req, res) => {
  res.json(db.completions.slice(-30).reverse());
});

// Abonnements aux notifications
app.post('/api/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!db.users.some((u) => u.id === userId) || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }
  db.subscriptions = db.subscriptions.filter((s) => s.subscription.endpoint !== subscription.endpoint);
  db.subscriptions.push({ userId, subscription });
  saveDb();
  res.status(201).json({ ok: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const endpoint = req.body.endpoint;
  db.subscriptions = db.subscriptions.filter((s) => s.subscription.endpoint !== endpoint);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/test-notification', async (req, res) => {
  const user = db.users.find((u) => u.id === req.body.userId);
  if (!user) return res.status(400).json({ error: 'Utilisateur inconnu' });
  await notifyUsers([user.id], { title: 'M-nage', body: `Les notifications fonctionnent, ${user.name} !` });
  res.json({ ok: true });
});

// ---------- Rappels : vérification chaque minute ----------
async function checkReminders() {
  const now = Date.now();
  const due = db.tasks.filter((t) => t.dueAt && !t.reminded && Date.parse(t.dueAt) <= now);
  if (!due.length) return;
  for (const task of due) {
    task.reminded = true;
  }
  saveDb();
  for (const task of due) {
    const targets = task.assigneeId ? [task.assigneeId] : db.users.map((u) => u.id);
    await notifyUsers(targets, {
      title: `Rappel : ${task.title}`,
      body: `${task.points} point${task.points > 1 ? 's' : ''} à gagner !`,
      tag: task.id,
    });
  }
}

setInterval(() => checkReminders().catch(console.error), 60 * 1000);

app.listen(PORT, () => {
  console.log(`M-nage démarré sur http://localhost:${PORT}`);
});
