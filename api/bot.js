const { Telegraf, Markup } = require('telegraf');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);

// قنوات الملفات لكل فرقة
const CHANNELS = {
  '1': process.env.CHANNEL_Y1 || process.env.FILES_CHANNEL_ID,
  '2': process.env.CHANNEL_Y2 || process.env.FILES_CHANNEL_ID,
};

const FORCE_SUB_CHANNEL = process.env.FORCE_SUB_CHANNEL;
const FORCE_SUB_LINK = process.env.FORCE_SUB_LINK;

const YEARS = {
  '1': 'الفرقة الأولى',
  '2': 'الفرقة الثانية',
};

const SEMESTERS = {
  's1': 'Semester 1 (التيرم الأول)',
  's2': 'Semester 2 (التيرم الثاني)',
};

// فحص الاشتراك الإجباري
async function checkSubscription(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_SUB_CHANNEL, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (error) {
    console.error('Error checking subscription:', error);
    return false;
  }
}

function sendSubscriptionPrompt(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 انضم للقناة أولاً', FORCE_SUB_LINK)],
    [Markup.button.callback('✅ تحقق من الانضمام', 'check_sub')],
  ]);
  const text = '⚠️ عذراً، يجب عليك الانضمام إلى القناة أولاً لتتمكن من استخدام البوت:';
  
  if (isEdit) return ctx.editMessageText(text, keyboard);
  return ctx.reply(text, keyboard);
}

function sendMainMenu(ctx, isEdit = false) {
  const buttons = Object.keys(YEARS).map((key) => [
    Markup.button.callback(`🎓 ${YEARS[key]}`, `year_${key}`),
  ]);
  const text = '📚 مرحباً بك في بوت المواد والمحاضرات!\n\nاختر الفرقة الدراسية للمتابعة:';

  if (isEdit) return ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  return ctx.reply(text, Markup.inlineKeyboard(buttons));
}

// أمر البدء /start
bot.start(async (ctx) => {
  await db.collection('users').doc(ctx.from.id.toString()).set({
    userId: ctx.from.id,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || '',
    updatedAt: new Date().toISOString()
  }, { merge: true });

  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx);

  return sendMainMenu(ctx);
});

bot.action('check_sub', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    return ctx.answerCbQuery('❌ لم تنضم للقناة بعد!', { show_alert: true });
  }
  await ctx.answerCbQuery('✅ تم التحقق بنجاح');
  return sendMainMenu(ctx, true);
});

// الخطوة 1: اختيار التيرم بعد الفرقة
bot.action(/year_(\d+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const year = ctx.match[1];
  const buttons = [
    [Markup.button.callback('📖 Semester 1', `sem_${year}_s1`)],
    [Markup.button.callback('📖 Semester 2', `sem_${year}_s2`)],
    [Markup.button.callback('⬅️ رجوع للفرق', 'back_home')],
  ];

  await ctx.editMessageText(`اختر الفصل الدراسي لـ (${YEARS[year]}):`, Markup.inlineKeyboard(buttons));
  await ctx.answerCbQuery();
});

// الخطوة 2: عرض المواد المتاحة (Subjects) داخل الفرقة والتيرم
bot.action(/sem_(\d+)_(s[12])/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const year = ctx.match[1];
  const sem = ctx.match[2];

  const snapshot = await db.collection('materials')
    .where('year', '==', year)
    .where('semester', '==', sem)
    .get();

  if (snapshot.empty) {
    return ctx.editMessageText(
      `لا توجد مواد مضافة حالياً في (${YEARS[year]} - ${SEMESTERS[sem]}).`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع للتيرمات', `year_${year}`)]])
    );
  }

  // تجميع المواد الفريدة بدون تكرار
  const subjectsMap = new Map();
  snapshot.forEach((doc) => {
    const data = doc.data();
    const subName = data.subjectName || data.name; // التوافق مع البيانات
    if (!subjectsMap.has(subName)) {
      subjectsMap.set(subName, true);
    }
  });

  const buttons = [];
  subjectsMap.forEach((_, subjectName) => {
    // نمرر الفرقة والتيرم واسم المادة
    buttons.push([Markup.button.callback(`📚 ${subjectName}`, `subj_${year}_${sem}_${encodeURIComponent(subjectName)}`)]);
  });
  buttons.push([Markup.button.callback('⬅️ رجوع للتيرمات', `year_${year}`)]);

  await ctx.editMessageText(`📚 مواد ${YEARS[year]} (${SEMESTERS[sem]}):\nاختر المادة لعرض محاضراتها:`, Markup.inlineKeyboard(buttons));
  await ctx.answerCbQuery();
});

// الخطوة 3: عرض محاضرات وملفات المادة المحددة
bot.action(/subj_(\d+)_(s[12])_(.+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const year = ctx.match[1];
  const sem = ctx.match[2];
  const subjectName = decodeURIComponent(ctx.match[3]);

  const snapshot = await db.collection('materials')
    .where('year', '==', year)
    .where('semester', '==', sem)
    .where('subjectName', '==', subjectName)
    .get();

  if (snapshot.empty) {
    return ctx.editMessageText(
      `لا توجد محاضرات مضافة حالياً لمادة (${subjectName}).`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع للمواد', `sem_${year}_${sem}`)]])
    );
  }

  const buttons = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const lectureTitle = data.lectureTitle || data.name;
    buttons.push([Markup.button.callback(`📄 ${lectureTitle}`, `get_${doc.id}`)]);
  });
  buttons.push([Markup.button.callback('⬅️ رجوع للمواد', `sem_${year}_${sem}`)]);

  await ctx.editMessageText(`📑 محاضرات مادة: *${subjectName}*\nاختر المحاضرة أو الملف للتحميل:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
  await ctx.answerCbQuery();
});

// الخطوة 4: إرسال الملف للطالب
bot.action(/get_(.+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const docId = ctx.match[1];
  const doc = await db.collection('materials').doc(docId).get();

  if (!doc.exists) {
    return ctx.answerCbQuery('الملف غير متاح حالياً');
  }

  const item = doc.data();
  const targetChannel = CHANNELS[item.year] || process.env.FILES_CHANNEL_ID;

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, targetChannel, item.messageId);
    await ctx.answerCbQuery('✅ تم إرسال المحاضرة بنجاح');
  } catch (error) {
    console.error('Copy file error:', error);
    await ctx.reply('⚠️ تعذر إرسال الملف، تأكد من وجود البوت كأدمن في القناة.');
  }
});

// رجوع للقائمة الرئيسية
bot.action('back_home', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);
  return sendMainMenu(ctx, true);
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
    res.status(200).send('Bot Serverless Running.');
  }
};
