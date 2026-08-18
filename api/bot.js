const { Telegraf, Markup } = require('telegraf');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);

// قناة ملفات الفرقة الثانية
const CHANNEL_ID = process.env.CHANNEL_Y2 || process.env.FILES_CHANNEL_ID;

const FORCE_SUB_CHANNEL = process.env.FORCE_SUB_CHANNEL;
const FORCE_SUB_LINK = process.env.FORCE_SUB_LINK;

const SEMESTERS = {
  's1': 'الفصل الدراسي الأول (Semester 1)',
  's2': 'الفصل الدراسي الثاني (Semester 2)',
};

// التحقق من اشتراك الطالب في القناة الإجبارية
async function checkSubscription(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_SUB_CHANNEL, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (error) {
    console.error('Subscription check error:', error);
    return false;
  }
}

// واجهة طلب الاشتراك الإجباري
function sendSubscriptionPrompt(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 انضم للقناة أولاً', FORCE_SUB_LINK)],
    [Markup.button.callback('✅ تحقق من الانضمام', 'check_sub')],
  ]);
  const text = '⚠️ عذراً، يجب عليك الانضمام إلى القناة أولاً لتتمكن من استخدام البوت:';
  if (isEdit) return ctx.editMessageText(text, keyboard);
  return ctx.reply(text, keyboard);
}

// القائمة الرئيسية: اختيار الفصل الدراسي (Semester 1 / Semester 2)
function sendMainMenu(ctx, isEdit = false) {
  const buttons = [
    [Markup.button.callback('📖 الفصل الدراسي الأول (Semester 1)', 'sem_2_s1')],
    [Markup.button.callback('📖 الفصل الدراسي الثاني (Semester 2)', 'sem_2_s2')],
  ];
  const text = '🎓 <b>أهلاً بك في منصة الفرقة الثانية!</b>\n\nاختر الفصل الدراسي للمتابعة:';

  if (isEdit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  return ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

// أمر البدء /start
bot.start(async (ctx) => {
  // حفظ بيانات الطالب في Firestore
  await db.collection('users').doc(ctx.from.id.toString()).set({
    userId: ctx.from.id,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || '',
    year: '2',
    updatedAt: new Date().toISOString()
  }, { merge: true });

  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx);

  return sendMainMenu(ctx);
});

// زر التحقق من الاشتراك
bot.action('check_sub', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    return ctx.answerCbQuery('❌ لم تنضم للقناة بعد!', { show_alert: true });
  }
  await ctx.answerCbQuery('✅ تم التحقق بنجاح');
  return sendMainMenu(ctx, true);
});

// 1. عرض المواد داخل التيرم (معالجة آمنة لحجم الأزرار)
bot.action(/sem_2_(s[12])/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const sem = ctx.match[1];

  const snapshot = await db.collection('materials')
    .where('year', '==', '2')
    .where('semester', '==', sem)
    .get();

  if (snapshot.empty) {
    return ctx.editMessageText(
      `لا توجد مواد مضافة حالياً في (${SEMESTERS[sem]}).`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع للتيرمات', 'back_home')]])
    );
  }

  // تجميع المواد واستخدام docId لضمان عدم تجاوز 64 بايت في callback_data
  const subjectsMap = new Map();
  snapshot.forEach((doc) => {
    const data = doc.data();
    const subName = data.subjectName || data.name;
    if (!subjectsMap.has(subName)) {
      subjectsMap.set(subName, doc.id);
    }
  });

  const buttons = [];
  subjectsMap.forEach((docId, subjectName) => {
    buttons.push([Markup.button.callback(`📚 ${subjectName}`, `sub_${sem}_${docId}`)]);
  });
  buttons.push([Markup.button.callback('⬅️ رجوع للتيرمات', 'back_home')]);

  await ctx.editMessageText(`📚 <b>مواد ${SEMESTERS[sem]}:</b>\nاختر المادة لعرض محاضراتها:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
  await ctx.answerCbQuery();
});

// 2. عرض المحاضرات والملفات الخاصة بالمادة
bot.action(/sub_(s[12])_(.+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const sem = ctx.match[1];
  const refDocId = ctx.match[2];

  const refDoc = await db.collection('materials').doc(refDocId).get();
  if (!refDoc.exists) {
    return ctx.answerCbQuery('المادة غير موجودة');
  }

  const subjectName = refDoc.data().subjectName || refDoc.data().name;

  const snapshot = await db.collection('materials')
    .where('year', '==', '2')
    .where('semester', '==', sem)
    .where('subjectName', '==', subjectName)
    .get();

  if (snapshot.empty) {
    return ctx.editMessageText(
      `لا توجد محاضرات مضافة حالياً لمادة (${subjectName}).`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع للمواد', `sem_2_${sem}`)]])
    );
  }

  const buttons = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const icon = data.categoryIcon || '📄';
    const title = data.lectureTitle || data.name;
    buttons.push([Markup.button.callback(`${icon} ${title}`, `get_${doc.id}`)]);
  });
  buttons.push([Markup.button.callback('⬅️ رجوع للمواد', `sem_2_${sem}`)]);

  await ctx.editMessageText(`📑 محتوى مادة: <b>${subjectName}</b>\nاختر الملف المطلوب للتحميل:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
  await ctx.answerCbQuery();
});

// 3. إرسال الملف للطالب عبر النسخ من القناة
bot.action(/get_(.+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const docId = ctx.match[1];
  const doc = await db.collection('materials').doc(docId).get();

  if (!doc.exists) {
    return ctx.answerCbQuery('الملف غير متاح حالياً');
  }

  const item = doc.data();

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, CHANNEL_ID, item.messageId);
    await ctx.answerCbQuery('✅ تم إرسال الملف بنجاح');
  } catch (error) {
    console.error('Copy file error:', error);
    await ctx.reply('⚠️ تعذر إرسال الملف، تأكد من وجود البوت كأدمن في القناة.');
  }
});

// الرجوع للقائمة الرئيسية
bot.action('back_home', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);
  return sendMainMenu(ctx, true);
});

// Handler لـ Vercel Serverless Function
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
    res.status(200).send('Bot Active.');
  }
};
