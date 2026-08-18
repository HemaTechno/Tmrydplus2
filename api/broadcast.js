const { Telegraf } = require('telegraf');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY; // كلمة سر لحماية الإرسال

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { secretKey, message } = req.body;
  if (secretKey !== ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const usersSnapshot = await db.collection('users').get();
    let sentCount = 0;
    let failCount = 0;

    const promises = usersSnapshot.docs.map(async (doc) => {
      const { userId } = doc.data();
      try {
        await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML' });
        sentCount++;
      } catch (err) {
        failCount++;
      }
    });

    await Promise.all(promises);

    return res.status(200).json({
      success: true,
      totalUsers: usersSnapshot.size,
      sentCount,
      failCount
    });
  } catch (error) {
    console.error('Broadcast error:', error);
    return res.status(500).json({ error: 'Broadcast failed' });
  }
};
