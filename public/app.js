// Interface de l'application M-nage (données partagées via Firebase).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, deleteDoc, getDocs, onSnapshot,
  query, where, orderBy, limit, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getMessaging, getToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import { firebaseConfig, vapidKey } from './firebase-config.js';

const state = { users: [], tasks: [], weekOffset: 0 };

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- Stockage local (préférences de ce téléphone) ----------
function local(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

const getCurrentUserId = () => local('userId');
const setCurrentUserId = (id) => local('userId', id);
const userName = (id) => (state.users.find((u) => u.id === id) || {}).name;

// ---------- Firebase ----------
const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
let db;
let swRegistration;

if ('serviceWorker' in navigator) {
  swRegistration = navigator.serviceWorker.register('sw.js');
}

// ---------- Rendu ----------
function renderUserSelects() {
  const current = $('#current-user');
  const currentId = getCurrentUserId();
  current.replaceChildren(el('option', { value: '', textContent: 'Qui êtes-vous ?' }));
  for (const u of state.users) {
    current.append(el('option', { value: u.id, textContent: u.name, selected: u.id === currentId }));
  }

  const assignee = $('#assignee-select');
  const selected = assignee.value;
  assignee.replaceChildren(el('option', { value: '', textContent: 'Tout le monde' }));
  for (const u of state.users) {
    assignee.append(el('option', { value: u.id, textContent: u.name, selected: u.id === selected }));
  }

  const list = $('#user-list');
  list.replaceChildren();
  for (const u of state.users) {
    const del = el('button', { className: 'icon', textContent: '🗑️', title: 'Supprimer' });
    del.addEventListener('click', () => deleteUser(u));
    list.append(el('li', {}, el('span', { className: 'task-info', textContent: u.name }), del));
  }
}

function formatDue(iso) {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const RECURRENCE_LABEL = { daily: 'chaque jour', weekly: 'chaque semaine' };

function renderTasks() {
  const list = $('#task-list');
  list.replaceChildren();
  const tasks = [...state.tasks].sort((a, b) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  });
  $('#no-tasks').style.display = tasks.length ? 'none' : 'block';

  for (const t of tasks) {
    const meta = el('div', { className: 'task-meta' });
    meta.append(`👤 ${userName(t.assigneeId) || 'Tout le monde'}`);
    if (t.dueAt) {
      const late = Date.parse(t.dueAt) < Date.now();
      meta.append(' · ', el('span', { className: late ? 'late' : '', textContent: `⏰ ${formatDue(t.dueAt)}` }));
    }
    if (RECURRENCE_LABEL[t.recurrence]) meta.append(` · 🔁 ${RECURRENCE_LABEL[t.recurrence]}`);

    const done = el('button', { className: 'done', textContent: '✓', title: 'Fait !' });
    done.addEventListener('click', () => completeTask(t).catch((err) => toast(err.message)));
    const del = el('button', { className: 'icon', textContent: '🗑️', title: 'Supprimer' });
    del.addEventListener('click', () => deleteTask(t).catch((err) => toast(err.message)));

    list.append(
      el('li', {},
        el('div', { className: 'task-info' }, el('div', { className: 'task-title', textContent: t.title }), meta),
        el('span', { className: 'points', textContent: `${t.points} pts` }),
        done,
        del
      )
    );
  }
}

function weekStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - day + offset * 7);
  return d;
}

async function renderRanking() {
  if (!db) return;
  const start = weekStart(state.weekOffset);
  const end = weekStart(state.weekOffset + 1);
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const last = new Date(end.getTime() - 1);
  $('#week-label').textContent =
    state.weekOffset === 0 ? `Cette semaine (${fmt(start)} – ${fmt(last)})` : `${fmt(start)} – ${fmt(last)}`;
  $('#next-week').disabled = state.weekOffset >= 0;

  const snap = await getDocs(
    query(collection(db, 'completions'), where('at', '>=', start.toISOString()), where('at', '<', end.toISOString()))
  );
  const scores = state.users.map((u) => ({ userId: u.id, name: u.name, points: 0, tasks: 0 }));
  snap.forEach((d) => {
    const c = d.data();
    const s = scores.find((x) => x.userId === c.userId);
    if (s) {
      s.points += c.points;
      s.tasks += 1;
    }
  });
  scores.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const medals = ['🥇', '🥈', '🥉'];
  const list = $('#ranking');
  list.replaceChildren();
  scores.forEach((s, i) => {
    list.append(
      el('li', {},
        el('span', { className: 'rank', textContent: s.points > 0 && medals[i] ? medals[i] : `${i + 1}` }),
        el('span', { className: 'name', textContent: s.name }),
        el('span', { className: 'task-meta', textContent: `${s.tasks} tâche${s.tasks > 1 ? 's' : ''}` }),
        el('span', { className: 'points', textContent: `${s.points} pts` })
      )
    );
  });
  if (!scores.length) list.append(el('p', { className: 'empty', textContent: 'Ajoutez les membres du foyer.' }));

  const history = await getDocs(query(collection(db, 'completions'), orderBy('at', 'desc'), limit(30)));
  const h = $('#history');
  h.replaceChildren();
  history.forEach((d) => {
    const c = d.data();
    const when = new Date(c.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    h.append(
      el('li', {},
        el('span', { className: 'task-info', textContent: `${userName(c.userId) || '?'} — ${c.title}` }),
        el('span', { className: 'task-meta', textContent: when }),
        el('span', { className: 'points', textContent: `+${c.points}` })
      )
    );
  });
}

const rankingVisible = () => $('#view-ranking').classList.contains('active');

// ---------- Actions ----------
function nextDue(dueAt, recurrence) {
  const step = recurrence === 'daily' ? 1 : recurrence === 'weekly' ? 7 : 0;
  const d = new Date(dueAt);
  const now = new Date();
  do {
    d.setDate(d.getDate() + step);
  } while (d <= now);
  return d.toISOString();
}

async function completeTask(task) {
  const userId = getCurrentUserId();
  if (!userId || !userName(userId)) {
    toast('Choisissez d’abord qui vous êtes (en haut).');
    $('#current-user').focus();
    return;
  }
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'completions')), {
    taskId: task.id,
    title: task.title,
    userId,
    points: task.points,
    at: new Date().toISOString(),
  });
  const ref = doc(db, 'tasks', task.id);
  if (task.recurrence === 'none') {
    batch.delete(ref);
  } else if (task.dueAt) {
    batch.update(ref, { dueAt: nextDue(task.dueAt, task.recurrence), reminded: false });
  }
  await batch.commit();
  toast(`Bravo ${userName(userId)} ! +${task.points} points 🎉`);
  if (rankingVisible()) renderRanking();
}

async function deleteTask(task) {
  if (!confirm(`Supprimer la tâche « ${task.title} » ?`)) return;
  await deleteDoc(doc(db, 'tasks', task.id));
}

async function deleteUser(user) {
  if (!confirm(`Supprimer ${user.name} ? Ses points passés ne compteront plus dans le classement.`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', user.id));
  for (const t of state.tasks) {
    if (t.assigneeId === user.id) batch.update(doc(db, 'tasks', t.id), { assigneeId: null });
  }
  const tokens = await getDocs(query(collection(db, 'tokens'), where('userId', '==', user.id)));
  tokens.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  if (getCurrentUserId() === user.id) setCurrentUserId('');
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!db) return;
  const f = new FormData(e.target);
  const title = String(f.get('title') || '').trim();
  const points = parseInt(f.get('points'), 10);
  const dueAt = f.get('dueAt');
  if (!title) return toast('Titre requis');
  if (!Number.isInteger(points) || points < 1) return toast('Points invalides');
  try {
    await addDoc(collection(db, 'tasks'), {
      title,
      points,
      assigneeId: f.get('assigneeId') || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      recurrence: f.get('recurrence'),
      reminded: false,
    });
    e.target.reset();
    e.target.closest('details').open = false;
    toast('Tâche ajoutée');
  } catch (err) {
    toast(err.message);
  }
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!db) return;
  const input = e.target.elements.name;
  const name = input.value.trim();
  if (!name) return;
  if (state.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
    return toast('Ce prénom existe déjà');
  }
  try {
    const ref = await addDoc(collection(db, 'users'), { name });
    if (!getCurrentUserId()) setCurrentUserId(ref.id);
    input.value = '';
  } catch (err) {
    toast(err.message);
  }
});

$('#current-user').addEventListener('change', async (e) => {
  setCurrentUserId(e.target.value);
  // Si ce téléphone reçoit les rappels, les rattacher au nouvel utilisateur.
  const token = local('fcmToken');
  if (token && e.target.value && db) {
    await setDoc(doc(db, 'tokens', token), { userId: e.target.value, updatedAt: new Date().toISOString() });
  }
  updateNotifStatus();
});

// Onglets
document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === btn.dataset.view));
    if (btn.dataset.view === 'view-ranking') renderRanking().catch((err) => toast(err.message));
  });
});

$('#prev-week').addEventListener('click', () => {
  state.weekOffset -= 1;
  renderRanking().catch((err) => toast(err.message));
});
$('#next-week').addEventListener('click', () => {
  if (state.weekOffset < 0) state.weekOffset += 1;
  renderRanking().catch((err) => toast(err.message));
});

// ---------- Notifications ----------
let messagingSupported = false;

function updateNotifStatus() {
  const status = $('#notif-status');
  const enable = $('#notif-enable');
  const test = $('#notif-test');
  if (!messagingSupported) {
    status.textContent = 'Ce navigateur ne gère pas les notifications. Sur iPhone, ajoutez d’abord l’application à l’écran d’accueil.';
    enable.style.display = test.style.display = 'none';
    return;
  }
  const on = Notification.permission === 'granted' && Boolean(local('fcmToken'));
  status.textContent = on
    ? `✅ Notifications activées sur ce téléphone pour ${userName(getCurrentUserId()) || '…'}.`
    : Notification.permission === 'denied'
      ? '🚫 Notifications bloquées : autorisez-les dans les réglages du téléphone.'
      : 'Notifications désactivées sur ce téléphone.';
  enable.style.display = on ? 'none' : 'block';
  test.style.display = on ? 'block' : 'none';
}

$('#notif-enable').addEventListener('click', async () => {
  const userId = getCurrentUserId();
  if (!userId || !userName(userId)) {
    toast('Choisissez d’abord qui vous êtes (en haut).');
    return;
  }
  if (!vapidKey) {
    toast('Clé de notification manquante dans firebase-config.js');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notifications refusées');
      return updateNotifStatus();
    }
    const token = await getToken(getMessaging(), {
      vapidKey,
      serviceWorkerRegistration: await swRegistration,
    });
    await setDoc(doc(db, 'tokens', token), { userId, updatedAt: new Date().toISOString() });
    local('fcmToken', token);
    toast('Notifications activées');
  } catch (err) {
    toast(`Impossible d’activer : ${err.message}`);
  }
  updateNotifStatus();
});

$('#notif-test').addEventListener('click', async () => {
  const reg = await swRegistration;
  await reg.showNotification('M-nage', {
    body: `Les notifications s’affichent bien, ${userName(getCurrentUserId()) || ''} !`,
    icon: 'icon-192.png',
  });
});

// ---------- Démarrage ----------
async function start() {
  if (!configured) {
    $('#setup-warning').hidden = false;
    renderTasks();
    return;
  }
  const app = initializeApp(firebaseConfig);
  await signInAnonymously(getAuth(app));
  db = getFirestore(app);

  messagingSupported = 'serviceWorker' in navigator && 'Notification' in window && (await isSupported());

  onSnapshot(query(collection(db, 'users'), orderBy('name')), (snap) => {
    state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUserSelects();
    renderTasks();
    updateNotifStatus();
    if (rankingVisible()) renderRanking().catch(() => {});
  });

  onSnapshot(collection(db, 'tasks'), (snap) => {
    state.tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTasks();
  });
}

start().catch((err) => toast(`Erreur de connexion : ${err.message}`));
