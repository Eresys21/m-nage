// Envoie les rappels des tâches arrivées à échéance (lancé par GitHub Actions).
// Nécessite la variable d'environnement FIREBASE_SERVICE_ACCOUNT (JSON du compte de service).
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT manquant');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const db = admin.firestore();
const messaging = admin.messaging();

const INVALID_TOKEN_ERRORS = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
];

async function main() {
  const now = new Date().toISOString();
  const pending = await db.collection('tasks').where('reminded', '==', false).get();
  const due = pending.docs.filter((d) => d.data().dueAt && d.data().dueAt <= now);
  console.log(`${due.length} rappel(s) à envoyer`);
  if (!due.length) return;

  const tokenDocs = (await db.collection('tokens').get()).docs;

  for (const taskDoc of due) {
    const task = taskDoc.data();
    const targets = tokenDocs.filter((t) => !task.assigneeId || t.data().userId === task.assigneeId);

    if (targets.length) {
      const res = await messaging.sendEachForMulticast({
        tokens: targets.map((t) => t.id),
        data: {
          title: `Rappel : ${task.title}`,
          body: `${task.points} point${task.points > 1 ? 's' : ''} à gagner !`,
          tag: taskDoc.id,
        },
        webpush: { headers: { Urgency: 'high' } },
      });
      await Promise.all(
        res.responses.map((r, i) =>
          !r.success && INVALID_TOKEN_ERRORS.includes(r.error.code) ? targets[i].ref.delete() : null
        )
      );
      console.log(`« ${task.title} » : ${res.successCount} envoyé(s), ${res.failureCount} échec(s)`);
    }

    await taskDoc.ref.update({ reminded: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
