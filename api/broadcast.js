const { Telegraf, Markup } = require('telegraf');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { secretKey, message, isNotification, fileData } = req.body;
  if (secretKey !== ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'رمز الحماية غير صحيح' });
  }

  try {
    const snapshot = await db.collection('users').get();
    if (snapshot.empty) {
      return res.status(200).json({ success: true, sentCount: 0, failCount: 0 });
    }

    let sentCount = 0;
    let failCount = 0;

    const promises = snapshot.docs.map(async (doc) => {
      const { userId } = doc.data();
      try {
        if (isNotification && fileData) {
          const notifText = 
            `🔔 <b>تنبيه بنزول محتوى جديد!</b>\n\n` +
            `📚 <b>المادة:</b> ${fileData.subjectName}\n` +
            `🏷 <b>النوع:</b> ${fileData.category || '📑 محاضرة'}\n` +
            `📄 <b>العنوان:</b> ${fileData.lectureTitle}\n\n` +
            `اضغط على الزر أدناه لتحميل الملف فوراً 👇`;

          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('📥 استلام الملف الآن', `get_${fileData.id}`)]
          ]);

          await bot.telegram.sendMessage(userId, notifText, { parse_mode: 'HTML', ...keyboard });
        } else {
          await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML' });
        }
        sentCount++;
      } catch (err) {
        failCount++;
      }
    });

    await Promise.all(promises);

    return res.status(200).json({
      success: true,
      totalUsers: snapshot.size,
      sentCount,
      failCount
    });
  } catch (error) {
    console.error('Broadcast error:', error);
    return res.status(500).json({ error: 'فشل الإرسال' });
  }
};
