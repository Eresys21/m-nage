// Interface de l'application M-nage.
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

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Erreur réseau');
  }
  return res.status === 204 ? null : res.json();
}

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- Utilisateur courant ----------
function getCurrentUserId() {
  try {
    return localStorage.getItem('userId');
  } catch {
    return null;
  }
}

function setCurrentUserId(id) {
  try {
    localStorage.setItem('userId', id);
  } catch {}
}

const userName = (id) => (state.users.find((u) => u.id === id) || {}).name;

// ---------- Rendu ----------
function renderUserSelects() {
  const current = $('#current-user');
  const currentId = getCurrentUserId();
  current.replaceChildren(el('option', { value: '', textContent: 'Qui êtes-vous ?' }));
  for (const u of state.users) {
    current.append(el('option', { value: u.id, textContent: u.name, selected: u.id === currentId }));
  }

  const assignee = $('#assignee-select');
  assignee.replaceChildren(el('option', { value: '', textContent: 'Tout le monde' }));
  for (const u of state.users) {
    assignee.append(el('option', { value: u.id, textContent: u.name }));
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

    const done = el('button', { className: 'done', textContent: '✓' , title: 'Fait !' });
    done.addEventListener('click', () => completeTask(t));
    const del = el('button', { className: 'icon', textContent: '🗑️', title: 'Supprimer' });
    del.addEventListener('click', () => deleteTask(t));

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

async function renderRanking() {
  const data = await api(`/api/leaderboard?offset=${state.weekOffset}`);
  const start = new Date(data.start);
  const end = new Date(Date.parse(data.end) - 1);
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  $('#week-label').textContent =
    state.weekOffset === 0 ? `Cette semaine (${fmt(start)} – ${fmt(end)})` : `${fmt(start)} – ${fmt(end)}`;
  $('#next-week').disabled = state.weekOffset >= 0;

  const medals = ['🥇', '🥈', '🥉'];
  const list = $('#ranking');
  list.replaceChildren();
  data.scores.forEach((s, i) => {
    list.append(
      el('li', {},
        el('span', { className: 'rank', textContent: s.points > 0 && medals[i] ? medals[i] : `${i + 1}` }),
        el('span', { className: 'name', textContent: s.name }),
        el('span', { className: 'task-meta', textContent: `${s.tasks} tâche${s.tasks > 1 ? 's' : ''}` }),
        el('span', { className: 'points', textContent: `${s.points} pts` })
      )
    );
  });
  if (!data.scores.length) list.append(el('p', { className: 'empty', textContent: 'Ajoutez les membres du foyer.' }));

  const history = await api('/api/completions');
  const h = $('#history');
  h.replaceChildren();
  for (const c of history) {
    const when = new Date(c.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    h.append(
      el('li', {},
        el('span', { className: 'task-info', textContent: `${userName(c.userId) || '?'} — ${c.title}` }),
        el('span', { className: 'task-meta', textContent: when }),
        el('span', { className: 'points', textContent: `+${c.points}` })
      )
    );
  }
}

async function refresh() {
  [state.users, state.tasks] = await Promise.all([api('/api/users'), api('/api/tasks')]);
  renderUserSelects();
  renderTasks();
  if ($('#view-ranking').classList.contains('active')) await renderRanking();
  updateNotifStatus();
}

// ---------- Actions ----------
async function completeTask(task) {
  const userId = getCurrentUserId();
  if (!userId) {
    toast('Choisissez d’abord qui vous êtes (en haut).');
    $('#current-user').focus();
    return;
  }
  const res = await api(`/api/tasks/${task.id}/complete`, { method: 'POST', body: { userId } });
  toast(`Bravo ${userName(userId)} ! +${res.points} points 🎉`);
  await refresh();
}

async function deleteTask(task) {
  if (!confirm(`Supprimer la tâche « ${task.title} » ?`)) return;
  await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
  await refresh();
}

async function deleteUser(user) {
  if (!confirm(`Supprimer ${user.name} ? Ses points passés ne compteront plus dans le classement.`)) return;
  await api(`/api/users/${user.id}`, { method: 'DELETE' });
  if (getCurrentUserId() === user.id) setCurrentUserId('');
  await refresh();
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const dueAt = f.get('dueAt');
  try {
    await api('/api/tasks', {
      method: 'POST',
      body: {
        title: f.get('title'),
        points: f.get('points'),
        assigneeId: f.get('assigneeId') || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        recurrence: f.get('recurrence'),
      },
    });
    e.target.reset();
    e.target.closest('details').open = false;
    toast('Tâche ajoutée');
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  try {
    const user = await api('/api/users', { method: 'POST', body: { name: input.value } });
    if (!getCurrentUserId()) setCurrentUserId(user.id);
    input.value = '';
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$('#current-user').addEventListener('change', async (e) => {
  setCurrentUserId(e.target.value);
  // Si ce téléphone est abonné, rattacher l'abonnement au nouvel utilisateur.
  const sub = await getSubscription();
  if (sub && e.target.value) {
    await api('/api/subscribe', { method: 'POST', body: { userId: e.target.value, subscription: sub } });
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
  renderRanking();
});
$('#next-week').addEventListener('click', () => {
  if (state.weekOffset < 0) state.weekOffset += 1;
  renderRanking();
});

// ---------- Notifications ----------
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function getSubscription() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function updateNotifStatus() {
  const status = $('#notif-status');
  const enable = $('#notif-enable');
  const test = $('#notif-test');
  if (!pushSupported) {
    status.textContent = 'Ce navigateur ne gère pas les notifications. Sur iPhone, ajoutez d’abord l’application à l’écran d’accueil.';
    enable.style.display = test.style.display = 'none';
    return;
  }
  const sub = await getSubscription();
  const on = sub && Notification.permission === 'granted';
  status.textContent = on
    ? `✅ Notifications activées sur ce téléphone pour ${userName(getCurrentUserId()) || '…'}.`
    : Notification.permission === 'denied'
      ? '🚫 Notifications bloquées : autorisez-les dans les réglages du navigateur.'
      : 'Notifications désactivées sur ce téléphone.';
  enable.style.display = on ? 'none' : 'block';
  test.style.display = on ? 'block' : 'none';
}

$('#notif-enable').addEventListener('click', async () => {
  const userId = getCurrentUserId();
  if (!userId) {
    toast('Choisissez d’abord qui vous êtes (en haut).');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Notifications refusées');
      return updateNotifStatus();
    }
    const { key } = await api('/api/vapid-public-key');
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    await api('/api/subscribe', { method: 'POST', body: { userId, subscription: sub } });
    toast('Notifications activées');
  } catch (err) {
    toast(`Impossible d’activer : ${err.message}`);
  }
  updateNotifStatus();
});

$('#notif-test').addEventListener('click', async () => {
  try {
    await api('/api/test-notification', { method: 'POST', body: { userId: getCurrentUserId() } });
    toast('Notification envoyée');
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

refresh().catch((err) => toast(err.message));
setInterval(() => refresh().catch(() => {}), 30 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh().catch(() => {});
});
