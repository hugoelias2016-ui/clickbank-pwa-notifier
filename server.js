const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const webpush = require('web-push');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const CLICKBANK_SECRET_KEY = process.env.CB_SECRET_KEY || "ELIASNOTIF2026";

const VAPID_FILE = path.join(__dirname, 'vapid.json');
let vapidKeys;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
  };
} else if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
}

webpush.setVapidDetails(
  'mailto:contato@seudominio.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];
if (fs.existsSync(SUBS_FILE)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch (e) {
    subscriptions = [];
  }
}

function saveSubscriptions() {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
}

let recentTransactions = [];

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscriptions.some(s => s.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
    saveSubscriptions();
    console.log(`[Push] Novo dispositivo inscrito! Total inscritos: ${subscriptions.length}`);
  }
  res.status(201).json({ message: "Inscrito com sucesso!" });
});

app.get('/api/transactions', (req, res) => {
  res.json(recentTransactions);
});

function decryptClickbankPayload(encryptedJson, secretKey) {
  const { notification, iv } = encryptedJson;
  const ivBuffer = Buffer.from(iv, 'base64');
  const encryptedBuffer = Buffer.from(notification, 'base64');
  const keyHash = crypto.createHash('sha1').update(secretKey).digest('hex').substring(0, 32);

  const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, ivBuffer);
  let decrypted = decipher.update(encryptedBuffer, null, 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

app.post('/webhook/clickbank', (req, res) => {
  try {
    let transactionData = null;
    if (req.body && req.body.notification && req.body.iv) {
      transactionData = decryptClickbankPayload(req.body, CLICKBANK_SECRET_KEY);
    } else {
      transactionData = req.body;
    }

    console.log("Recebido ClickBank:", transactionData);

    const transactionType = transactionData.transactionType || 'SALE';
    const amount = transactionData.totalOrderAmount || transactionData.amount || '0.00';
    const itemTitle = transactionData.lineItemTitle || (transactionData.lineItems && transactionData.lineItems[0]?.itemTitle) || 'Produto';

    recentTransactions.unshift({
      type: transactionType,
      amount: amount,
      itemTitle: itemTitle,
      date: new Date()
    });

    if (recentTransactions.length > 50) recentTransactions.pop();

    const payload = JSON.stringify({
      title: `Venda Realizada: $${amount}!`,
      body: `${itemTitle} - Tipo: ${transactionType}`
    });

    console.log(`[Push] Disparando notificação para ${subscriptions.length} dispositivo(s)...`);

    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload, { TTL: 86400, urgency: 'high' })
        .then(() => console.log(`[Push] Notificação entregue com sucesso para:`, sub.endpoint.substring(0, 45) + '...'))
        .catch(err => {
          console.error(`[Push] Erro ao entregar:`, err.statusCode, err.message);
          if (err.statusCode === 410 || err.statusCode === 404) {
            subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
            saveSubscriptions();
          }
        });
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no processamento do INS:", err);
    res.status(400).send("Erro de descriptografia");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
