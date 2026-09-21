const { Telegraf } = require('telegraf');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET || ADMIN_SECRET_KEY; 

module.exports = async (req, res) => {
  try {
    const configDoc = await db.collection('settings').doc('scheduleConfig').get();
    const config = configDoc.exists ? configDoc.data() : null;

    if (!config || !config.channelId) {
      return res.status(400).json({ error: 'إعدادات الجدول أو آيدي القناة غير مسجلة في قاعدة البيانات' });
    }

    // 1️⃣ حالة الإرسال اليدوي الفوري من لوحة التحكم
    if (req.method === 'POST') {
      const { secretKey, action, dayIndex } = req.body;
      if (secretKey !== ADMIN_SECRET_KEY) return res.status(403).json({ error: 'رمز الحماية غير صحيح' });
      
      if (action === 'send_now') {
        const content = config.days && config.days[dayIndex];
        if (!content) return res.status(404).json({ error: 'لا يوجد محتوى مسجل لهذا اليوم' });

        const message = `📢 📅 <b>جدول محاضرات الغد</b> 📅 📢\n\n${content}\n\n✨ <i>تمنياتنا لكم بالتوفيق والنجاح!</i> 🎓`;
        await bot.telegram.sendMessage(config.channelId, message, { parse_mode: 'HTML' });
        
        return res.status(200).json({ success: true, message: 'تم الإرسال فوراً' });
      }
    }

    // 2️⃣ حالة الإرسال التلقائي عبر Vercel Cron Job (مرة واحدة يومياً 8 مساءً)
    if (req.method === 'GET') {
      if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: 'غير مصرح لك' });
      }

      const egyptTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
      const tomorrow = new Date(egyptTime.getTime() + (24 * 60 * 60 * 1000));
      const tomorrowIndex = tomorrow.getDay().toString();

      const content = config.days && config.days[tomorrowIndex];
      
      if (content && content.trim() !== "") {
        const message = `📢 📅 <b>جدول محاضرات الغد</b> 📅 📢\n\n${content}\n\n✨ <i>تمنياتنا لكم بالتوفيق والنجاح!</i> 🎓`;
        await bot.telegram.sendMessage(config.channelId, message, { parse_mode: 'HTML' });
        return res.status(200).json({ success: true, message: 'تم إرسال جدول الغد بنجاح' });
      } else {
        return res.status(200).json({ success: true, message: 'لا يوجد جدول مسجل للغد، تم التخطي.' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Schedule Error:', error);
    return res.status(500).json({ error: 'حدث خطأ في السيرفر' });
  }
};
