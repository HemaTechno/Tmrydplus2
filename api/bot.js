const { Telegraf, Markup } = require('telegraf');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);

const FILES_CHANNEL_ID = process.env.FILES_CHANNEL_ID; // القناة التي تحتوي على ملفات الـ PDF
const FORCE_SUB_CHANNEL = process.env.FORCE_SUB_CHANNEL; // يوزر أو آيدي قناة الاشتراك الإجباري (مثال: @mychannel)
const FORCE_SUB_LINK = process.env.FORCE_SUB_LINK; // رابط الانضمام للقناة

const YEARS = {
  '1': 'الفرقة الأولى',
  '2': 'الفرقة الثانية',
};

const SEMESTERS = {
  's1': 'الفصل الدراسي الأول (Semester 1)',
  's2': 'الفصل الدراسي الثاني (Semester 2)',
};

// فحص الاشتراك الإجباري
async function checkSubscription(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_SUB_CHANNEL, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (error) {
    console.error('Error checking subscription:', error);
    // لو لم يتم العثور على المستخدم أو القناة
    return false;
  }
}

// واجهة طلب الاشتراك
function sendSubscriptionPrompt(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 انضم للقناة أولاً', FORCE_SUB_LINK)],
    [Markup.button.callback('✅ تحقق من الانضمام', 'check_sub')],
  ]);
  const text = '⚠️ عذراً، يجب عليك الانضمام إلى قناة البوت أولاً لتتمكن من استخدامه:\n\nاضغط على الزر أدناه ثم اضغط "تحقق".';
  
  if (isEdit) {
    return ctx.editMessageText(text, keyboard);
  }
  return ctx.reply(text, keyboard);
}

// القائمة الرئيسية (اختيار الفرقة)
async function sendMainMenu(ctx, isEdit = false) {
  const buttons = Object.keys(YEARS).map((key) => [
    Markup.button.callback(YEARS[key], `year_${key}`),
  ]);
  const text = '🎓 مرحباً بك في بوت المواد الدراسية!\n\nاختر الفرقة الدراسية للمتابعة:';

  if (isEdit) {
    return ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  }
  return ctx.reply(text, Markup.inlineKeyboard(buttons));
}

// أمر البدء /start
bot.start(async (ctx) => {
  // حفظ أو تحديث المستخدم في قاعدة البيانات للإذاعة
  const userRef = db.collection('users').doc(ctx.from.id.toString());
  await userRef.set({
    userId: ctx.from.id,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || '',
    updatedAt: new Date().toISOString()
  }, { merge: true });

  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    return sendSubscriptionPrompt(ctx);
  }

  return sendMainMenu(ctx);
});

// زر التحقق بعد الانضمام
bot.action('check_sub', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    return ctx.answerCbQuery('❌ لم تنضم للقناة بعد!', { show_alert: true });
  }
  await ctx.answerCbQuery('✅ تم التحقق بنجاح');
  return sendMainMenu(ctx, true);
});

// اختيار التيرم بعد الفرقة
bot.action(/year_(\d+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const year = ctx.match[1];
  const buttons = [
    [Markup.button.callback('📖 Semester 1', `sem_${year}_s1`)],
    [Markup.button.callback('📖 Semester 2', `sem_${year}_s2`)],
    [Markup.button.callback('⬅️ العودة للفرق', 'back_home')],
  ];

  await ctx.editMessageText(`اختر الفصل الدراسي لـ (${YEARS[year]}):`, Markup.inlineKeyboard(buttons));
  await ctx.answerCbQuery();
});

// عرض المواد المتاحة للتيرم المحدد
bot.action(/sem_(\d+)_(s[12])/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const year = ctx.match[1];
  const sem = ctx.match[2];

  // جلب المواد من Firestore
  const snapshot = await db.collection('materials')
    .where('year', '==', year)
    .where('semester', '==', sem)
    .get();

  if (snapshot.empty) {
    return ctx.editMessageText(
      `لا توجد مواد مضافة حالياً في (${YEARS[year]} - ${SEMESTERS[sem]}).`,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ رجوع', `year_${year}`)]])
    );
  }

  const buttons = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    buttons.push([Markup.button.callback(`📄 ${data.name}`, `get_${doc.id}`)]);
  });
  buttons.push([Markup.button.callback('⬅️ رجوع للتيرمات', `year_${year}`)]);

  await ctx.editMessageText(`قائمة المواد المتاحة:\n📚 ${YEARS[year]} - ${SEMESTERS[sem]}`, Markup.inlineKeyboard(buttons));
  await ctx.answerCbQuery();
});

// إرسال الملف المطلوب
bot.action(/get_(.+)/, async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const docId = ctx.match[1];
  const doc = await db.collection('materials').doc(docId).get();

  if (!doc.exists) {
    return ctx.answerCbQuery('عذراً، هذا الملف غير متاح.');
  }

  const material = doc.data();
  try {
    await ctx.telegram.copyMessage(ctx.chat.id, FILES_CHANNEL_ID, material.messageId);
    await ctx.answerCbQuery('✅ تم إرسال الملف');
  } catch (error) {
    console.error('Error copying file:', error);
    await ctx.reply('⚠️ حدث خطأ أثناء إرسال الملف، تأكد من صلاحيات البوت في القناة.');
  }
});

// العودة للقائمة الرئيسية
bot.action('back_home', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);
  return sendMainMenu(ctx, true);
});

// Serverless Handler لـ Vercel
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
    res.status(200).send('Bot Serverless Endpoint Active.');
  }
};
