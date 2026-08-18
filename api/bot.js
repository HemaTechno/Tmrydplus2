const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const { db } = require('../firebaseAdmin');

const bot = new Telegraf(process.env.BOT_TOKEN);

const CHANNEL_ID = process.env.CHANNEL_Y2 || process.env.FILES_CHANNEL_ID;
const FORCE_SUB_CHANNEL = process.env.FORCE_SUB_CHANNEL;
const FORCE_SUB_LINK = process.env.FORCE_SUB_LINK;
const DEV_USERNAME = 'Hema_tech1';
const DEV_LINK = `https://t.me/${DEV_USERNAME}`;

const SEMESTERS = {
  's3': 'الفصل الدراسي الثالث (Semester 3)',
  's4': 'الفصل الدراسي الرابع (Semester 4)',
};

// فحص وضع الصيانة
async function isMaintenanceMode() {
  try {
    const doc = await db.collection('settings').doc('system').get();
    return doc.exists && doc.data().maintenance === true;
  } catch (e) {
    return false;
  }
}

// واجهة وضع الصيانة
function sendMaintenanceMessage(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 قناة التليجرام', FORCE_SUB_LINK)],
    [Markup.button.url('👨‍💻 تواصل مع المطور', DEV_LINK)]
  ]);
  const text = '🛠 <b>البوت تحت الصيانة حالياً!</b>\n\nجاري العمل على حل المشكلة وتحديث النظام، يرجى المحاولة لاحقاً.';

  if (isEdit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

// فحص الاشتراك الإجباري
async function checkSubscription(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(FORCE_SUB_CHANNEL, ctx.from.id);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (error) {
    console.error('Subscription check error:', error);
    return false;
  }
}

function sendSubscriptionPrompt(ctx, isEdit = false) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('📢 انضم للقناة أولاً', FORCE_SUB_LINK)],
    [Markup.button.callback('✅ تحقق من الانضمام', 'check_sub')],
    [Markup.button.url('👨‍💻 تواصل مع المطور', DEV_LINK)]
  ]);
  const text = '⚠️ عذراً، يجب عليك الانضمام إلى القناة أولاً لتتمكن من استخدام البوت:';
  if (isEdit) return ctx.editMessageText(text, keyboard);
  return ctx.reply(text, keyboard);
}

// القائمة الرئيسية للبوت
function sendMainMenu(ctx, isEdit = false) {
  const buttons = [
    [Markup.button.callback('📖 الفصل الدراسي الثالث (Semester 3)', 'sem_2_s3')],
    [Markup.button.callback('📖 الفصل الدراسي الرابع (Semester 4)', 'sem_2_s4')],
    [Markup.button.callback('⭐ ملفاتي المحفوظة (المفضلة)', 'view_favorites')],
    [Markup.button.url('👨‍💻 تواصل مع المطور', DEV_LINK)]
  ];
  const text = '🎓 <b>أهلاً بك في منصة الفرقة الثانية!</b>\n\nاختر من القائمة أدناه للمتابعة:';

  if (isEdit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  return ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

// أمر البدء /start وتثبيت زر Menu
bot.start(async (ctx) => {
  // تثبيت الأمر في زر الـ Menu بشكل دائم
  ctx.telegram.setMyCommands([
    { command: 'start', description: '🏠 القائمة الرئيسية والبدء' }
  ]).catch(() => {});

  if (await isMaintenanceMode()) {
    return sendMaintenanceMessage(ctx);
  }

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

bot.action('check_sub', async (ctx) => {
  if (await isMaintenanceMode()) return sendMaintenanceMessage(ctx, true);

  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    return ctx.answerCbQuery('❌ لم تنضم للقناة بعد!', { show_alert: true });
  }
  await ctx.answerCbQuery('✅ تم التحقق بنجاح');
  return sendMainMenu(ctx, true);
});

// 1. عرض المواد داخل التيرم
bot.action(/sem_2_(s[34])/, async (ctx) => {
  if (await isMaintenanceMode()) return sendMaintenanceMessage(ctx, true);
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
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]
      ])
    );
  }

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
  
  // زر العودة للقائمة الرئيسية
  buttons.push([Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]);

  await ctx.editMessageText(`📚 <b>مواد ${SEMESTERS[sem]}:</b>\nاختر المادة لعرض محاضراتها:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
  await ctx.answerCbQuery();
});

// 2. عرض المحاضرات داخل المادة
bot.action(/sub_(s[34])_(.+)/, async (ctx) => {
  if (await isMaintenanceMode()) return sendMaintenanceMessage(ctx, true);
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const sem = ctx.match[1];
  const refDocId = ctx.match[2];

  const refDoc = await db.collection('materials').doc(refDocId).get();
  if (!refDoc.exists) return ctx.answerCbQuery('المادة غير موجودة');

  const subjectName = refDoc.data().subjectName || refDoc.data().name;

  const snapshot = await db.collection('materials')
    .where('year', '==', '2')
    .where('semester', '==', sem)
    .where('subjectName', '==', subjectName)
    .get();

  if (snapshot.empty) {
    return ctx.editMessageText(
      `لا توجد محاضرات مضافة حالياً لمادة (${subjectName}).`,
      Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ رجوع للمواد', `sem_2_${sem}`)],
        [Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]
      ])
    );
  }

  const buttons = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const icon = data.categoryIcon || '📄';
    const title = data.lectureTitle || data.name;
    buttons.push([Markup.button.callback(`${icon} ${title}`, `get_${doc.id}`)]);
  });

  // أزرار التنقل والرجوع
  buttons.push([
    Markup.button.callback('⬅️ رجوع للمواد', `sem_2_${sem}`),
    Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')
  ]);

  await ctx.editMessageText(`📑 محتوى مادة: <b>${subjectName}</b>\nاختر الملف المطلوب للتحميل:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
  await ctx.answerCbQuery();
});

// 3. إرسال الملف والتنقل
bot.action(/get_(.+)/, async (ctx) => {
  if (await isMaintenanceMode()) return sendMaintenanceMessage(ctx, true);
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const docId = ctx.match[1];
  const doc = await db.collection('materials').doc(docId).get();

  if (!doc.exists) return ctx.answerCbQuery('الملف غير متاح حالياً');

  const currentItem = doc.data();

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, CHANNEL_ID, currentItem.messageId);

    const allLecturesSnap = await db.collection('materials')
      .where('year', '==', currentItem.year)
      .where('semester', '==', currentItem.semester)
      .where('subjectName', '==', currentItem.subjectName)
      .get();

    const lecturesList = allLecturesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const currentIndex = lecturesList.findIndex(item => item.id === docId);

    const navButtons = [];
    const row1 = [];

    if (currentIndex > 0) {
      row1.push(Markup.button.callback('⬅️ السابقة', `get_${lecturesList[currentIndex - 1].id}`));
    }
    if (currentIndex >= 0 && currentIndex < lecturesList.length - 1) {
      row1.push(Markup.button.callback('التالية ➡️', `get_${lecturesList[currentIndex + 1].id}`));
    }
    if (row1.length > 0) navButtons.push(row1);

    navButtons.push([
      Markup.button.callback('⭐ حفظ في المفضلة', `fav_add_${docId}`),
      Markup.button.callback('📁 قائمة المادة', `sub_${currentItem.semester}_${docId}`)
    ]);

    navButtons.push([
      Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')
    ]);

    await ctx.reply(
      `📌 <b>${currentItem.lectureTitle || currentItem.name}</b>\n📚 مادة: ${currentItem.subjectName}\n\nتحكم في التنقل أو احفظ المحاضرة:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(navButtons) }
    );

    await ctx.answerCbQuery('✅ تم إرسال الملف');
  } catch (error) {
    console.error('Copy file error:', error);
    await ctx.reply('⚠️ تعذر إرسال الملف، تأكد من وجود البوت كأدمن في القناة.');
  }
});

// 4. حفظ في المفضلة
bot.action(/fav_add_(.+)/, async (ctx) => {
  const docId = ctx.match[1];
  await db.collection('users').doc(ctx.from.id.toString()).set({
    favorites: admin.firestore.FieldValue.arrayUnion(docId)
  }, { merge: true });

  await ctx.answerCbQuery('⭐ تم حفظ المحاضرة في مفضلتك بنجاح!', { show_alert: true });
});

// 5. استعراض المفضلة
bot.action('view_favorites', async (ctx) => {
  if (await isMaintenanceMode()) return sendMaintenanceMessage(ctx, true);
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) return sendSubscriptionPrompt(ctx, true);

  const userDoc = await db.collection('users').doc(ctx.from.id.toString()).get();
  const favIds = (userDoc.exists && userDoc.data().favorites) || [];

  if (favIds.length === 0) {
    return ctx.editMessageText(
      '⭐ ليس لديك أي ملفات محفوظة في المفضلة حتى الآن.\nيمكنك حفظ أي محاضرة بالضغط على "⭐ حفظ في المفضلة" عند استلامها.',
      Markup.inlineKeyboard([
        [Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]
      ])
    );
  }

  const buttons = [];
  for (const id of favIds) {
    const doc = await db.collection('materials').doc(id).get();
    if (doc.exists) {
      const data = doc.data();
      buttons.push([Markup.button.callback(`📄 ${data.subjectName} - ${data.lectureTitle}`, `get_${id}`)]);
    }
  }
  buttons.push([Markup.button.callback('🏠 القائمة الرئيسية', 'back_home')]);

  await ctx.editMessageText('⭐ <b>ملفاتك المحفوظة في المفضلة:</b>\nاضغط على أي ملف لتحميله مباشرة:', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(buttons)
  });
  await ctx.answerCbQuery();
});

// الرجوع للقائمة الرئيسية
bot.action('back_home', async (ctx) => {
  if (await isMaintenanceMode()) return sendMaintenanceMessage(ctx, true);
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
    res.status(200).send('Bot Active.');
  }
};
