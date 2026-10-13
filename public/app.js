// Interface de l'application M-nage (données partagées via Firebase).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, onSnapshot,
  query, where, orderBy, limit, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getMessaging, getToken, isSupported } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';
import { firebaseConfig, vapidKey } from './firebase-config.js';

const DEFAULT_TIERS = [
  { points: 50, euros: 5 },
  { points: 100, euros: 10 },
  { points: 140, euros: 20 },
  { points: 180, euros: 30 },
];
const MAX_EUROS = 30;

const state = {
  users: [],
  tasks: [],
  suggestions: [],
  bonuses: [],
  tiers: DEFAULT_TIERS,
  isAdmin: false,
  me: null, // membre connecté sur ce téléphone
  weekOffset: 0,
  monthOffset: 0,
};

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

function button(text, className, onClick, title) {
  const b = el('button', { className, textContent: text, title: title || '' });
  b.addEventListener('click', () => Promise.resolve(onClick()).catch((err) => toast(err.message)));
  return b;
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

const getCurrentUserId = () => state.me;
const userName = (id) => (state.users.find((u) => u.id === id) || {}).name;

function requireCurrentUser() {
  const userId = getCurrentUserId();
  if (!userId || !userName(userId)) {
    toast('Connectez-vous d’abord : choisissez votre prénom en haut.');
    $('#current-user').focus();
    return null;
  }
  return userId;
}

// Une tâche ne peut être validée que par la personne à qui elle est attribuée (ou par tous si « Tout le monde »).
const canComplete = (t) => Boolean(state.me) && (!t.assigneeId || t.assigneeId === state.me);

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ---------- Firebase ----------
const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
let db;
let auth;
let swRegistration;

if ('serviceWorker' in navigator) {
  swRegistration = navigator.serviceWorker.register('sw.js');
}

// ---------- Rendu : membres ----------
function renderUserSelects() {
  const current = $('#current-user');
  const currentId = getCurrentUserId();
  current.replaceChildren(el('option', { value: '', textContent: 'Se connecter…' }));
  for (const u of state.users.filter((x) => x.email)) {
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
    list.append(
      el('li', {},
        el('span', { className: 'task-info' },
          u.name,
          u.email ? null : el('span', { className: 'no-access', textContent: ' · pas encore de mot de passe' })
        ),
        state.isAdmin && !state.me ? button('🙋', 'icon', () => linkMe(u), 'C’est moi') : null,
        state.isAdmin ? button('🔑', 'icon', () => createAccess(u), 'Définir le mot de passe') : null,
        state.isAdmin ? button('🗑️', 'icon', () => deleteUser(u), 'Supprimer') : null
      )
    );
  }
  $('#user-form').hidden = !state.isAdmin;
}

// ---------- Rendu : tâches ----------
function formatDue(iso) {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const RECURRENCE_LABEL = { daily: 'chaque jour', weekly: 'chaque semaine' };

function taskMeta(t) {
  const meta = el('div', { className: 'task-meta' });
  meta.append(`👤 ${userName(t.assigneeId) || 'Tout le monde'}`);
  if (t.dueAt) {
    const late = Date.parse(t.dueAt) < Date.now();
    meta.append(' · ', el('span', { className: late ? 'late' : '', textContent: `⏰ ${formatDue(t.dueAt)}` }));
  }
  if (RECURRENCE_LABEL[t.recurrence]) meta.append(` · 🔁 ${RECURRENCE_LABEL[t.recurrence]}`);
  return meta;
}

function renderTasks() {
  const list = $('#task-list');
  list.replaceChildren();
  const tasks = state.tasks
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    });
  $('#no-tasks').style.display = tasks.length ? 'none' : 'block';

  for (const t of tasks) {
    list.append(
      el('li', {},
        el('div', { className: 'task-info' }, el('div', { className: 'task-title', textContent: t.title }), taskMeta(t)),
        el('span', { className: 'points', textContent: `${t.points} pts` }),
        canComplete(t) ? button('✓', 'done', () => completeTask(t), 'Fait !') : null,
        state.isAdmin ? button('✏️', 'icon', () => editTaskPoints(t), 'Modifier les points') : null,
        state.isAdmin ? button('🗑️', 'icon', () => deleteTask(t), 'Supprimer') : null
      )
    );
  }
}

function renderTaskForm() {
  $('#task-form-summary').textContent = state.isAdmin ? '➕ Ajouter une tâche' : '💡 Proposer une tâche';
  $('#task-form-submit').textContent = state.isAdmin ? 'Ajouter' : 'Proposer';
  $('#task-form-hint').hidden = state.isAdmin;
}

// ---------- Rendu : éléments à valider (administrateur) ----------
function pointsInput(value) {
  return el('input', { type: 'number', min: 1, max: 100, value: value || '', className: 'pending-points', placeholder: 'pts' });
}

function renderPending() {
  $('#admin-pending').hidden = !state.isAdmin;
  if (!state.isAdmin) return;

  const sList = $('#suggestion-list');
  sList.replaceChildren();
  for (const s of state.suggestions) {
    const input = pointsInput(s.points);
    const meta = taskMeta(s);
    meta.prepend(`💡 Proposée par ${userName(s.proposedBy) || '?'} · `);
    sList.append(
      el('li', {},
        el('div', { className: 'task-info' }, el('div', { className: 'task-title', textContent: s.title }), meta),
        input,
        button('✓', 'done', () => approveSuggestion(s, input.value), 'Valider'),
        button('✕', 'icon', () => rejectPending('suggestions', s), 'Refuser')
      )
    );
  }

  const bList = $('#bonus-list');
  bList.replaceChildren();
  for (const b of state.bonuses) {
    const input = pointsInput();
    const when = new Date(b.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    bList.append(
      el('li', {},
        el('div', { className: 'task-info' },
          el('div', { className: 'task-title', textContent: `⭐ ${b.title}` }),
          el('div', { className: 'task-meta', textContent: `Bonus de ${userName(b.userId) || '?'} · ${when}` })
        ),
        input,
        button('✓', 'done', () => approveBonus(b, input.value), 'Attribuer les points'),
        button('✕', 'icon', () => rejectPending('bonuses', b), 'Refuser')
      )
    );
  }

  $('#no-pending').style.display = state.suggestions.length || state.bonuses.length ? 'none' : 'block';
}

// ---------- Rendu : paliers ----------
function sortedTiers() {
  return [...state.tiers].sort((a, b) => a.points - b.points);
}

function renderTiers() {
  const view = $('#tier-view');
  view.replaceChildren();
  for (const t of sortedTiers()) {
    view.append(
      el('li', {},
        el('span', { className: 'task-info', textContent: `${t.points} points dans le mois` }),
        el('span', { className: 'euros', textContent: `${t.euros} €` })
      )
    );
  }
  view.hidden = state.isAdmin;
  $('#tier-form').hidden = !state.isAdmin;
  if (state.isAdmin) renderTierRows(sortedTiers());
}

function renderTierRows(tiers) {
  const rows = $('#tier-rows');
  rows.replaceChildren();
  for (const t of tiers) addTierRow(t);
}

function addTierRow(t = { points: '', euros: '' }) {
  const row = el('div', { className: 'tier-row' },
    el('input', { type: 'number', min: 1, value: t.points, name: 'points', required: true }),
    el('span', { textContent: 'pts →' }),
    el('input', { type: 'number', min: 0, max: MAX_EUROS, value: t.euros, name: 'euros', required: true }),
    el('span', { textContent: '€' })
  );
  row.append(button('🗑️', 'icon', () => row.remove(), 'Retirer'));
  $('#tier-rows').append(row);
}

// ---------- Rendu : classement et récompenses ----------
function weekStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - day + offset * 7);
  return d;
}

function monthStart(offset = 0) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1);
}

async function scoresBetween(start, end) {
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
  return scores.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

async function renderWeekRanking() {
  const start = weekStart(state.weekOffset);
  const end = weekStart(state.weekOffset + 1);
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const last = new Date(end.getTime() - 1);
  $('#week-label').textContent =
    state.weekOffset === 0 ? `Cette semaine (${fmt(start)} – ${fmt(last)})` : `${fmt(start)} – ${fmt(last)}`;
  $('#next-week').disabled = state.weekOffset >= 0;

  const scores = await scoresBetween(start, end);
  const medals = ['🥇', '🥈', '🥉'];
  const list = $('#ranking');
  list.replaceChildren();
  scores.forEach((s, i) => {
    list.append(
      el('li', {},
        el('span', { className: 'rank', textContent: s.points > 0 && medals[i] ? medals[i] : `${i + 1}` }),
        el('span', { className: 'name', textContent: s.name }),
        el('span', { className: 'task-meta', textContent: plural(s.tasks, 'tâche') }),
        el('span', { className: 'points', textContent: `${s.points} pts` })
      )
    );
  });
  if (!scores.length) list.append(el('p', { className: 'empty', textContent: 'Ajoutez les membres du foyer.' }));
}

async function renderRewards() {
  const start = monthStart(state.monthOffset);
  const end = monthStart(state.monthOffset + 1);
  const label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  $('#month-label').textContent = state.monthOffset === 0 ? `Ce mois-ci (${label})` : label;
  $('#next-month').disabled = state.monthOffset >= 0;

  const tiers = sortedTiers();
  const top = tiers.length ? tiers[tiers.length - 1].points : 0;
  const scores = await scoresBetween(start, end);
  const list = $('#rewards');
  list.replaceChildren();
  for (const s of scores) {
    const reached = tiers.filter((t) => s.points >= t.points);
    const euros = reached.length ? reached[reached.length - 1].euros : 0;
    const next = tiers.find((t) => s.points < t.points);
    const percent = top ? Math.min(100, Math.round((s.points / top) * 100)) : 0;
    const bar = el('div', { className: 'progress' }, el('span'));
    bar.firstChild.style.width = `${percent}%`;
    list.append(
      el('li', {},
        el('div', { className: 'task-info' },
          el('div', { className: 'task-title', textContent: s.name }),
          el('div', {
            className: 'task-meta',
            textContent: next
              ? `${s.points} pts · encore ${next.points - s.points} pts pour ${next.euros} €`
              : `${s.points} pts · palier maximum atteint 🎉`,
          }),
          bar
        ),
        el('span', { className: 'euros', textContent: `${euros} €` })
      )
    );
  }
  if (!scores.length) list.append(el('p', { className: 'empty', textContent: 'Ajoutez les membres du foyer.' }));
}

async function renderHistory() {
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

async function renderRanking() {
  if (!db) return;
  await Promise.all([renderWeekRanking(), renderRewards(), renderHistory()]);
}

const rankingVisible = () => $('#view-ranking').classList.contains('active');
const refreshRanking = () => {
  if (rankingVisible()) renderRanking().catch((err) => toast(err.message));
};

function renderAdminState() {
  const loggedIn = Boolean(state.me) || state.isAdmin;
  $('#admin-login').hidden = loggedIn;
  $('#admin-status').hidden = !loggedIn;
  const who = state.me ? `✅ Connecté : ${userName(state.me) || '…'}` : '✅ Connecté';
  $('#admin-status-text').textContent = state.isAdmin
    ? `${who} (administrateur)${state.me ? '' : ' — touchez 🙋 à côté de votre prénom pour relier votre compte.'}`
    : `${who}.`;
  renderUserSelects();
  renderTasks();
  renderTaskForm();
  renderPending();
  renderTiers();
}

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

function parsePoints(value) {
  const points = parseInt(value, 10);
  if (!Number.isInteger(points) || points < 1 || points > 100) throw new Error('Points invalides (1 à 100)');
  return points;
}

async function completeTask(task) {
  const userId = requireCurrentUser();
  if (!userId) return;
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
    batch.update(ref, { done: true });
  } else if (task.dueAt) {
    batch.update(ref, { dueAt: nextDue(task.dueAt, task.recurrence), reminded: false });
  }
  await batch.commit();
  toast(`Bravo ${userName(userId)} ! +${task.points} points 🎉`);
  refreshRanking();
}

async function editTaskPoints(task) {
  const value = prompt(`Points pour « ${task.title} » :`, task.points);
  if (value === null) return;
  await updateDoc(doc(db, 'tasks', task.id), { points: parsePoints(value) });
  toast('Points modifiés');
}

async function deleteTask(task) {
  if (!confirm(`Supprimer la tâche « ${task.title} » ?`)) return;
  await deleteDoc(doc(db, 'tasks', task.id));
}

async function deleteUser(user) {
  if (!confirm(`Supprimer ${user.name} ? Ses points passés ne compteront plus dans le classement.`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', user.id));
  if (user.uid) batch.delete(doc(db, 'accounts', user.uid));
  for (const t of state.tasks) {
    if (t.assigneeId === user.id) batch.update(doc(db, 'tasks', t.id), { assigneeId: null });
  }
  const tokens = await getDocs(query(collection(db, 'tokens'), where('userId', '==', user.id)));
  tokens.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// Crée (ou remplace) le compte de connexion d'un membre, sans déconnecter l'administrateur.
let secondaryAuth;
async function createAccess(user) {
  const password = prompt(`Mot de passe pour ${user.name} (6 caractères minimum) :`);
  if (password === null) return;
  if (password.length < 6) throw new Error('6 caractères minimum');
  if (!secondaryAuth) secondaryAuth = getAuth(initializeApp(firebaseConfig, 'comptes'));
  const email = `membre-${user.id.toLowerCase()}-${Date.now()}@m-nage.app`;
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await signOut(secondaryAuth);
  const batch = writeBatch(db);
  if (user.uid) batch.delete(doc(db, 'accounts', user.uid));
  batch.set(doc(db, 'accounts', cred.user.uid), { userId: user.id });
  batch.update(doc(db, 'users', user.id), { email, uid: cred.user.uid });
  await batch.commit();
  toast(`Mot de passe défini pour ${user.name}`);
}

// Relie le compte administrateur (e-mail) à son prénom dans le foyer.
async function linkMe(user) {
  if (!confirm(`Relier votre compte administrateur à ${user.name} ?`)) return;
  const { uid, email } = auth.currentUser;
  const batch = writeBatch(db);
  if (user.uid && user.uid !== uid) batch.delete(doc(db, 'accounts', user.uid));
  batch.set(doc(db, 'accounts', uid), { userId: user.id });
  batch.update(doc(db, 'users', user.id), { email, uid });
  await batch.commit();
  await loadIdentity(auth.currentUser);
}

async function approveSuggestion(s, pointsValue) {
  const points = parsePoints(pointsValue);
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'tasks')), {
    title: s.title,
    points,
    assigneeId: s.assigneeId || null,
    dueAt: s.dueAt || null,
    recurrence: s.recurrence || 'none',
    reminded: false,
    done: false,
  });
  batch.delete(doc(db, 'suggestions', s.id));
  await batch.commit();
  toast('Tâche ajoutée à la liste');
}

async function approveBonus(b, pointsValue) {
  const points = parsePoints(pointsValue);
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'completions')), {
    taskId: null,
    title: `⭐ ${b.title}`,
    userId: b.userId,
    points,
    at: b.createdAt,
    bonus: true,
  });
  batch.delete(doc(db, 'bonuses', b.id));
  await batch.commit();
  toast(`+${points} points pour ${userName(b.userId) || '?'}`);
  refreshRanking();
}

async function rejectPending(collectionName, item) {
  if (!confirm(`Refuser « ${item.title} » ?`)) return;
  await deleteDoc(doc(db, collectionName, item.id));
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!db) return;
  const f = new FormData(e.target);
  const title = String(f.get('title') || '').trim();
  const dueAt = f.get('dueAt');
  try {
    if (!title) throw new Error('Titre requis');
    const data = {
      title,
      points: parsePoints(f.get('points')),
      assigneeId: f.get('assigneeId') || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      recurrence: f.get('recurrence'),
    };
    if (state.isAdmin) {
      await addDoc(collection(db, 'tasks'), { ...data, reminded: false, done: false });
      toast('Tâche ajoutée');
    } else {
      const userId = requireCurrentUser();
      if (!userId) return;
      await addDoc(collection(db, 'suggestions'), { ...data, proposedBy: userId, createdAt: new Date().toISOString() });
      toast('Proposition envoyée à l’administrateur');
    }
    e.target.reset();
    e.target.closest('details').open = false;
  } catch (err) {
    toast(err.message);
  }
});

$('#bonus-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!db) return;
  const userId = requireCurrentUser();
  if (!userId) return;
  const title = e.target.elements.title.value.trim();
  if (!title) return;
  try {
    await addDoc(collection(db, 'bonuses'), { title, userId, createdAt: new Date().toISOString() });
    e.target.reset();
    e.target.closest('details').open = false;
    toast('Tâche bonus envoyée à l’administrateur');
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
    await addDoc(collection(db, 'users'), { name });
    input.value = '';
    toast(`${name} ajouté·e : touchez 🔑 pour définir son mot de passe`);
  } catch (err) {
    toast(err.message);
  }
});

$('#tier-add').addEventListener('click', () => addTierRow());

$('#tier-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const tiers = [...document.querySelectorAll('#tier-rows .tier-row')].map((row) => ({
      points: parseInt(row.querySelector('[name=points]').value, 10),
      euros: parseInt(row.querySelector('[name=euros]').value, 10),
    }));
    for (const t of tiers) {
      if (!Number.isInteger(t.points) || t.points < 1) throw new Error('Points de palier invalides');
      if (!Number.isInteger(t.euros) || t.euros < 0 || t.euros > MAX_EUROS) {
        throw new Error(`Les récompenses vont de 0 à ${MAX_EUROS} €`);
      }
    }
    tiers.sort((a, b) => a.points - b.points);
    if (new Set(tiers.map((t) => t.points)).size !== tiers.length) throw new Error('Deux paliers ont les mêmes points');
    await setDoc(doc(db, 'settings', 'rewards'), { tiers });
    toast('Paliers enregistrés');
  } catch (err) {
    toast(err.message);
  }
});

$('#admin-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { email, password } = e.target.elements;
  try {
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    password.value = '';
  } catch {
    toast('E-mail ou mot de passe incorrect');
  }
});

$('#admin-logout').addEventListener('click', () => signOut(auth));

let loginTarget = null;

$('#current-user').addEventListener('change', (e) => {
  const user = state.users.find((u) => u.id === e.target.value);
  e.target.value = state.me || '';
  if (!user || user.id === state.me) return;
  loginTarget = user;
  $('#login-title').textContent = `Connexion : ${user.name}`;
  $('#login-dialog').showModal();
  $('#login-form').elements.password.focus();
});

$('#login-cancel').addEventListener('click', () => $('#login-dialog').close());

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.password;
  try {
    await signInWithEmailAndPassword(auth, loginTarget.email, input.value);
    $('#login-dialog').close();
  } catch {
    toast('Mot de passe incorrect');
  }
  input.value = '';
});

// Onglets
document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === btn.dataset.view));
    refreshRanking();
  });
});

$('#prev-week').addEventListener('click', () => {
  state.weekOffset -= 1;
  renderWeekRanking().catch((err) => toast(err.message));
});
$('#next-week').addEventListener('click', () => {
  if (state.weekOffset < 0) state.weekOffset += 1;
  renderWeekRanking().catch((err) => toast(err.message));
});
$('#prev-month').addEventListener('click', () => {
  state.monthOffset -= 1;
  renderRewards().catch((err) => toast(err.message));
});
$('#next-month').addEventListener('click', () => {
  if (state.monthOffset < 0) state.monthOffset += 1;
  renderRewards().catch((err) => toast(err.message));
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
  const userId = requireCurrentUser();
  if (!userId) return;
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
let pendingUnsubscribers = [];

function watchPending() {
  pendingUnsubscribers.forEach((unsub) => unsub());
  pendingUnsubscribers = [];
  state.suggestions = [];
  state.bonuses = [];
  if (!state.isAdmin) return;
  pendingUnsubscribers.push(
    onSnapshot(query(collection(db, 'suggestions'), orderBy('createdAt')), (snap) => {
      state.suggestions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderPending();
    }),
    onSnapshot(query(collection(db, 'bonuses'), orderBy('createdAt')), (snap) => {
      state.bonuses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderPending();
    })
  );
}

let dataWatched = false;

function watchData() {
  if (dataWatched) return;
  dataWatched = true;

  onSnapshot(query(collection(db, 'users'), orderBy('name')), (snap) => {
    state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAdminState();
    updateNotifStatus();
    refreshRanking();
  });

  onSnapshot(collection(db, 'tasks'), (snap) => {
    state.tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTasks();
  });

  onSnapshot(doc(db, 'settings', 'rewards'), (snap) => {
    state.tiers = snap.exists() && Array.isArray(snap.data().tiers) ? snap.data().tiers : DEFAULT_TIERS;
    renderTiers();
    refreshRanking();
  });
}

async function loadIdentity(user) {
  const read = (path) => getDoc(doc(db, path, user.uid)).catch(() => null);
  const [adminDoc, accountDoc] = user.isAnonymous ? [] : await Promise.all([read('admins'), read('accounts')]);
  state.isAdmin = adminDoc?.exists() === true;
  state.me = accountDoc?.exists() ? accountDoc.data().userId : null;
  if (!user.isAnonymous && !state.isAdmin && !state.me) toast('Ce compte n’est relié à aucun membre.');
  // Les rappels de ce téléphone suivent la personne connectée.
  const token = local('fcmToken');
  if (token && state.me) {
    await setDoc(doc(db, 'tokens', token), { userId: state.me, updatedAt: new Date().toISOString() }).catch(() => {});
  }
  watchPending();
  renderAdminState();
  updateNotifStatus();
}

async function start() {
  renderTaskForm();
  if (!configured) {
    $('#setup-warning').hidden = false;
    renderTasks();
    return;
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  messagingSupported = 'serviceWorker' in navigator && 'Notification' in window && (await isSupported());
  updateNotifStatus();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      await signInAnonymously(auth).catch((err) => toast(`Erreur de connexion : ${err.message}`));
      return;
    }
    await loadIdentity(user);
    watchData();
  });
}

start().catch((err) => toast(`Erreur de connexion : ${err.message}`));
