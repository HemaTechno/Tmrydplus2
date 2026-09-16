const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);

const CHANNEL_ID = process.env.CHANNEL_Y2 || process.env.FILES_CHANNEL_ID;
const FORCE_SUB_CHANNEL = process.env.FORCE_SUB_CHANNEL;
const FORCE_SUB_LINK = process.env.FORCE_SUB_LINK;
const DEV_USERNAME = 'Hema_tech1';
const DEV_LINK = `https://t.me/${DEV_USERNAME}`;

// ==========================================
// 1. نظام الـ Caching
// ==========================================
const cache = {
  maintenance: false,
  subjectMaintenance: {}, 
  bannedUsers: new Set(),
  semesters: [],
  lastCheck: 0
};

async function updateCache() {
  const now = Date.now();
  if (now - cache.lastCheck > 60000) {
    try {
      const sysDoc = await db.collection('settings').doc('system').get();
      cache.maintenance = sysDoc.exists && sysDoc.data().maintenance === true;
      
      const subDoc = await db.collection('settings').doc('subjects').get();
      cache.subjectMaintenance = subDoc.exists ? subDoc.data() : {};
      
      const bannedSnap = await db.collection('users').where('isBanned', '==', true).get();
      cache.bannedUsers.clear();
      bannedSnap.forEach(doc => cache.bannedUsers.add(doc.id));

      const semSnap = await db.collection('semesters').orderBy('order', 'asc').get();
      cache.semesters = [];
      semSnap.forEach(doc => cache.semesters.push({ id: doc.id, ...doc.data() }));

      cache.lastCheck = now;
    } catch (e) {
      console.error('Cache update error:', e);
    }
  }
}

// ==========================================
// 2. واجهات الرسائل الأساسية
// ==========================================
function sendMaintenanceMessage(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 قناة التليجرام', FORCE_SUB_LINK)],
    [Markup.button.url('👨‍💻 تواصل مع المطور', DEV_LINK)]
  ]);
  const text = '🛠 <b>البوت تحت الصيانة حالياً!</b>\n\nجاري العمل على تحديث النظام، يرجى المحاولة لاحقاً.';
  if (isEdit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(()=>{});
  return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

function sendSubscriptionPrompt(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 انضم للقناة أولاً', FORCE_SUB_LINK)],
    [Markup.button.callback('✅ تحقق من الانضمام', 'check_sub')],
  ]);
  const text = '⚠️ <b>عذراً، يجب الانضمام إلى القناة أولاً لتتمكن من استخدام البوت:</b>';
  if (isEdit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(()=>{});
  return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

function sendMainMenu(ctx, isEdit = false) {
  const buttons = [];
  
  cache.semesters.forEach(sem => {
    if (sem.isActive) {
      buttons.push([Markup.button.callback(`📖 ${sem.name}`, `sem_2_${sem.id}`)]);
    }
  });

  buttons.push([Markup.button.callback('⭐ ملفاتي المحفوظة (المفضلة)', 'view_favorites')]);
  buttons.push([Markup.button.url('👨‍💻 تواصل مع المطور', DEV_LINK)]);
  
  const text = '🎓 <b>أهلاً بك في المنصة!</b>\n\nاختر من القائمة أدناه للمتابعة:';
  
  if (isEdit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }).catch(()=>{});
  return ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

// ==========================================
// 3. الـ Middlewares
// ==========================================
bot.use((ctx, next) => {
  if (ctx.from) {
    db.collection('users').doc(ctx.from.id.toString()).set({
      userId: ctx.from.id,
      username: ctx.from.username || null,
      firstName: ctx.from.first_name || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
  return next();
});

bot.use(async (ctx, next) => {
  await updateCache();
  if (ctx.from && cache.bannedUsers.has(ctx.from.id.toString())) {
    const text = '⛔ <b>عذراً، لقد تم حظرك من استخدام هذا البوت بواسطة الإدارة.</b>';
    if (ctx.callbackQuery) return ctx.answerCbQuery('⛔ لقد تم حظرك من استخدام البوت.', { show_alert: true }).catch(()=>{});
    return ctx.reply(text, { parse_mode: 'HTML' }).catch(()=>{});
  }
  if (cache.maintenance) return sendMaintenanceMessage(ctx, !!ctx.callbackQuery);
  return next();
});

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_sub') return next();
  try {
    const member = await ctx.telegram.getChatMember(FORCE_SUB_CHANNEL, ctx.from.id);
    const isSubscribed = ['creator', 'administrator', 'member'].includes(member.status);
    if (!isSubscribed) return sendSubscriptionPrompt(ctx, !!ctx.callbackQuery);
  } catch (error) {
    return sendSubscriptionPrompt(ctx, !!ctx.callbackQuery);
  }
  return next();
});

// ==========================================
// 4. الأوامر الأساسية
// ==========================================
bot.start((ctx) => {
  ctx.telegram.setMyCommands([{ command: 'start', description: '🏠 القائمة الرئيسية والبدء' }]).catch(() => {});
  return sendMainMenu(ctx);
});
bot.action('check_sub', (ctx) => { ctx.answerCbQuery('✅ تم التحقق بنجاح').catch(()=>{}); return sendMainMenu(ctx, true); });
bot.action('back_home', (ctx) => sendMainMenu(ctx, true));

// ==========================================
// 5. التنقل بين المواد والمحاضرات
// ==========================================
bot.action(/sem_2_(.+)/, async (ctx) => {
  const semId = ctx.match[1];
  const snapshot = await db.collection('materials').where('year', '==', '2').where('semester', '==', semId).get();
  
  const semData = cache.semesters.find(s => s.id === semId);
  const semName = semData ? semData.name : 'هذا الفصل الدراسي';

  if (snapshot.empty) {
    return ctx.editMessageText(`لا توجد مواد مضافة حالياً في (${semName}).`, Markup.inlineKeyboard([[Markup.button.callback('🏠 رجوع', 'back_home')]]));
  }

  const subjectsMap = new Map();
  snapshot.forEach((doc) => {
    const data = doc.data();
    subjectsMap.set(data.subjectName || data.name, doc.id);
  });

  const buttons = [];
  subjectsMap.forEach((docId, subjectName) => {
    const isSubMaintenance = cache.subjectMaintenance[subjectName] === true;
    const btnText = isSubMaintenance ? `🛠 ${subjectName} (تحديث)` : `📚 ${subjectName}`;
    const btnData = isSubMaintenance ? 'subject_maintenance' : `sub_${semId}_${docId}`;
    buttons.push([Markup.button.callback(btnText, btnData)]);
  });
  
  buttons.push([Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]);
  await ctx.editMessageText(`📚 <b>مواد ${semName}:</b>\nاختر المادة:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  ctx.answerCbQuery().catch(()=>{});
});

bot.action('subject_maintenance', (ctx) => ctx.answerCbQuery('🛠 هذه المادة تحت التحديث حالياً، جرب لاحقاً!', { show_alert: true }));

bot.action(/sub_([^_]+)_(.+)/, async (ctx) => {
  const semId = ctx.match[1];
  const refDocId = ctx.match[2];

  const refDoc = await db.collection('materials').doc(refDocId).get();
  if (!refDoc.exists) return ctx.answerCbQuery('المادة غير موجودة');

  const subjectName = refDoc.data().subjectName || refDoc.data().name;
  const snapshot = await db.collection('materials').where('year', '==', '2').where('semester', '==', semId).where('subjectName', '==', subjectName).get();

  const buttons = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const icon = data.categoryIcon || '📄';
    buttons.push([Markup.button.callback(`${icon} ${data.lectureTitle || data.name}`, `openlec_${doc.id}`)]);
  });

  buttons.push([Markup.button.callback('⬅️ رجوع', `sem_2_${semId}`), Markup.button.callback('🏠 الرئيسية', 'back_home')]);

  await ctx.editMessageText(`📑 محتوى مادة: <b>${subjectName}</b>\nاختر المحاضرة:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  ctx.answerCbQuery().catch(()=>{});
});

// ==========================================
// 6. فتح تفاصيل المحاضرة وإرسال الملف
// ==========================================
bot.action(/openlec_(.+)/, async (ctx) => {
  const docId = ctx.match[1];
  const doc = await db.collection('materials').doc(docId).get();
  if (!doc.exists) return ctx.answerCbQuery('المحاضرة غير متاحة');
  
  const data = doc.data();
  const userId = ctx.from.id.toString();
  
  const userDoc = await db.collection('users').doc(userId).get();
  const favorites = userDoc.exists ? (userDoc.data().favorites || {}) : {};
  const isFav = !!favorites[docId];

  const buttons = [];
  const contentRow = [];
  if (data.fileMessageId || data.messageId) contentRow.push(Markup.button.callback('📄 الملف', `sendf_main_${docId}`));
  if (data.questionsMessageId) contentRow.push(Markup.button.callback('📝 أسئلة', `sendf_ques_${docId}`));
  if (data.summaryMessageId) contentRow.push(Markup.button.callback('📑 ملخص', `sendf_summ_${docId}`));
  if (contentRow.length > 0) buttons.push(contentRow);

  buttons.push([Markup.button.callback(isFav ? '❌ حذف من المفضلة' : '⭐ حفظ في المفضلة', `fav_toggle_${docId}`)]);
  buttons.push([Markup.button.callback('🔙 رجوع لقائمة المادة', `sub_${data.semester}_${docId}`)]);

  const text = `📌 <b>${data.lectureTitle || data.name}</b>\n📚 المادة: ${data.subjectName}\n\nاختر ما تريد عرضه:`;
  await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  ctx.answerCbQuery().catch(()=>{});
});

bot.action(/sendf_(main|ques|summ)_(.+)/, async (ctx) => {
  const type = ctx.match[1];
  const docId = ctx.match[2];
  
  const doc = await db.collection('materials').doc(docId).get();
  if (!doc.exists) return ctx.answerCbQuery('الملف غير متاح', { show_alert: true });
  const data = doc.data();

  let msgId;
  if (type === 'main') msgId = data.fileMessageId || data.messageId;
  if (type === 'ques') msgId = data.questionsMessageId;
  if (type === 'summ') msgId = data.summaryMessageId;

  if (!msgId) return ctx.answerCbQuery('⚠️ هذا المرفق غير متوفر حالياً', { show_alert: true });

  // 👈 تم التعديل هنا: نرد على زر التيليجرام فوراً لفك التعليق قبل البدء في نقل الملف
  ctx.answerCbQuery('⏳ جاري إرسال الملف...').catch(()=>{});

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, CHANNEL_ID, msgId);
  } catch (error) {
    console.error("Error sending file:", error);
    // إرسال رسالة توضح الخطأ في حالة فشل الإرسال
    ctx.reply('⚠️ تعذر إرسال الملف. تأكد من أن البوت مسؤول في قناة الملفات وأن رقم الرسالة صحيح.').catch(()=>{});
  }
});

// ==========================================
// 7. نظام المفضلة السريع
// ==========================================
bot.action(/fav_toggle_(.+)/, async (ctx) => {
  const docId = ctx.match[1];
  const userId = ctx.from.id.toString();
  
  const doc = await db.collection('materials').doc(docId).get();
  if (!doc.exists) return ctx.answerCbQuery('حدث خطأ');
  
  const data = doc.data();
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();
  
  const favorites = userDoc.exists ? (userDoc.data().favorites || {}) : {};
  const isFav = !!favorites[docId];

  if (isFav) {
    await userRef.update({ [`favorites.${docId}`]: admin.firestore.FieldValue.delete() });
    ctx.answerCbQuery('❌ تم الحذف من المفضلة', { show_alert: true });
  } else {
    await userRef.set({
      favorites: { [docId]: { subjectName: data.subjectName, lectureTitle: data.lectureTitle || data.name, semester: data.semester } }
    }, { merge: true });
    ctx.answerCbQuery('⭐ تم الحفظ في المفضلة', { show_alert: true });
  }
  
  const newText = isFav ? '⭐ حفظ في المفضلة' : '❌ حذف من المفضلة';
  const inlineKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;
  const newKeyboard = inlineKeyboard.map(row => 
    row.map(btn => btn.callback_data === ctx.callbackQuery.data ? { ...btn, text: newText } : btn)
  );
  await ctx.editMessageReplyMarkup({ inline_keyboard: newKeyboard }).catch(()=>{});
});

bot.action('view_favorites', async (ctx) => {
  const userDoc = await db.collection('users').doc(ctx.from.id.toString()).get();
  const favorites = userDoc.exists ? (userDoc.data().favorites || {}) : {};
  const favKeys = Object.keys(favorites);

  if (favKeys.length === 0) {
    return ctx.editMessageText('⭐ المفضلة فارغة!\nيمكنك حفظ المحاضرات من داخل تفاصيل كل محاضرة.', Markup.inlineKeyboard([[Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]]));
  }

  const buttons = [];
  for (const docId of favKeys) {
    const data = favorites[docId];
    buttons.push([Markup.button.callback(`📄 ${data.subjectName} - ${data.lectureTitle}`, `openlec_${docId}`)]);
  }
  buttons.push([Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]);

  await ctx.editMessageText('⭐ <b>ملفاتك المحفوظة:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  ctx.answerCbQuery().catch(()=>{});
});

bot.catch((err, ctx) => {
  console.error(`[Error] Update ${ctx.update.update_id}:`, err);
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      console.error(err);
      res.status(500).send('Error');
    }
  } else {
    res.status(200).send('Bot Active 🚀');
  }
};
