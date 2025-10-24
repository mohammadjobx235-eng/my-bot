// app.js

require('dotenv').config(); // تحميل متغيرات البيئة من .env
const TelegramBot = require('node-telegram-bot-api');
const { connectDB } = require('./src/db_connect');
const { saveUserData, getUsersBySpecialization, deleteUserByTelegramId } = require('./src/user_model');
const { STATES, SPECIALIZATION_MAP } = require('./src/constants');

// --- إعدادات البوت والاتصال ---
//mongodb://localhost:27017/telegram_bot_db
const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// إنشاء مثيل للبوت
const bot = new TelegramBot(TOKEN, { polling: true });

// تخزين حالة المحادثة للمستخدمين
const userStates = {}; // {chatId: {state: 'ASK_NAME', data: {name: '', specialization: ''}}}

// --- معالجات الأوامر والرسائل ---

/** * يبدأ عملية إدخال البيانات. */
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { state: STATES.ASK_NAME, data: {} };
    bot.sendMessage(chatId, "أهلاً بك! لنبدأ بتسجيل بياناتك. ما هو اسمك الكامل؟");
});

/** * يلغي عملية إدخال البيانات. */
bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { state: STATES.IDLE, data: {} };
    bot.sendMessage(chatId, "تم إلغاء عملية إدخال البيانات. يمكنك البدء من جديد باستخدام الأمر /start.");
});

/** * يبدأ عملية حذف البيانات. */
bot.onText(/\/delete/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = [
        [{ text: "نعم، متأكد من الحذف", callback_data: 'confirm_delete' }],
        [{ text: "إلغاء الحذف", callback_data: 'cancel_delete' }],
    ];
    
    userStates[chatId] = { state: STATES.AWAIT_DELETE_CONFIRMATION, data: {} }; 

    bot.sendMessage(chatId,
        "**تنبيه:** هل أنت متأكد من أنك تريد حذف جميع بياناتك المسجلة؟ لا يمكن التراجع عن هذا الإجراء.",
        { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' }
    );
});


/** * يعالج إدخال الاسم وينتقل إلى سؤال معرّف التلغرام. */
function handleAskName(msg) {
    const chatId = msg.chat.id;
    const userName = msg.text;
    userStates[chatId].data.name = userName;
    
    userStates[chatId].state = STATES.ASK_USERNAME; 
    
    bot.sendMessage(chatId,
        `شكراً يا ${userName}. يرجى إدخال **معرّف التلغرام الخاص بك** (يبدأ بـ @) حتى يتمكن الآخرون من التواصل معك.`,
        { parse_mode: 'Markdown' }
    );
}

/** * يعالج إدخال معرّف التلغرام وينتقل إلى سؤال التخصص. */
function handleAskUsername(msg) {
    const chatId = msg.chat.id;
    const username = msg.text; 

    userStates[chatId].data.username = username; 
    
    userStates[chatId].state = STATES.ASK_SPECIALIZATION;

    const { name } = userStates[chatId].data;
    const keyboard = [
        [{ text: "ذكاء اصطناعي", callback_data: 'AI' }],
        [{ text: "برمجيات", callback_data: 'Software' }],
        [{ text: "شبكات", callback_data: 'Networks' }],
    ];
    bot.sendMessage(chatId,
        `رائع، تم حفظ معرّفك. الآن، ما هو تخصصك الرئيسي؟`,
        { reply_markup: { inline_keyboard: keyboard } }
    );
}

// app.js

function handleSpecializationSelection(chatId, specializationKey, messageId) {
    const specializationName = SPECIALIZATION_MAP[specializationKey];

    if (specializationName) {
        userStates[chatId].data.specialization = specializationName;
        userStates[chatId].state = STATES.ASK_TECHNOLOGIES;
        
        // **✅ التعديل هنا: نغير النص لضمان عدم ظهور خطأ "not modified"**
        bot.editMessageText(
            `✅ تم اختيار التخصص: **${specializationName}**.\n\n` +
            "الآن، يرجى إدخال قائمة بالتقنيات التي تعمل عليها...",
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }
}
/** * يعالج إدخال التقنيات ويحفظ كل البيانات. */
async function handleAskTechnologies(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const technologies = msg.text;
    
    const { name, username, specialization } = userStates[chatId].data; 

    await saveUserData(userId, name, username, specialization, technologies);

    bot.sendMessage(chatId,
        `شكراً جزيلاً! تم حفظ بياناتك بنجاح.\n` +
        `الاسم: ${name}\n` +
        `**معرّف التلغرام:** ${username}\n` + 
        `التخصص: ${specialization}\n` +
        `التقنيات: ${technologies}\n\n` +
        `يمكنك استخدام الأمر /view لعرض بيانات المسجلين حسب التخصص.`
    );
    userStates[chatId] = { state: STATES.IDLE, data: {} };
}

/** * معالجة ردود تأكيد حذف البيانات. */
async function handleDeleteConfirmation(chatId, userId, data, messageId) {
    userStates[chatId] = { state: STATES.IDLE, data: {} }; 

    if (data === 'confirm_delete') {
        const deleted = await deleteUserByTelegramId(userId);

        if (deleted) {
            bot.editMessageText(
                "✅ تم حذف بياناتك من قاعدة البيانات بنجاح.",
                { chat_id: chatId, message_id: messageId }
            );
        } else {
            bot.editMessageText(
                "⚠️ لم نتمكن من العثور على أي بيانات مسجلة باسمك لحذفها.",
                { chat_id: chatId, message_id: messageId }
            );
        }
    } else if (data === 'cancel_delete') {
        bot.editMessageText(
            "تم إلغاء عملية الحذف. بياناتك لم تتأثر.",
            { chat_id: chatId, message_id: messageId }
        );
    }
}


/** * يبدأ عملية عرض البيانات. */
bot.onText(/\/view/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = [
        [{ text: "عرض الذكاء الاصطناعي", callback_data: 'view_AI' }],
        [{ text: "عرض البرمجيات", callback_data: 'view_Software' }],
        [{ text: "عرض الشبكات", callback_data: 'view_Networks' }],
    ];
    bot.sendMessage(chatId,
        "اختر التخصص الذي تود عرض بيانات المسجلين فيه:",
        { reply_markup: { inline_keyboard: keyboard } }
    );
});

/** * معالجة ردود عرض البيانات. */
async function handleViewDataCallback(chatId, data, messageId) {
    const specializationKey = data.replace('view_', '');
    const specializationName = SPECIALIZATION_MAP[specializationKey];

    try {
        const users = await getUsersBySpecialization(specializationName); 
        let responseText;
        if (users.length === 0) {
            responseText = `لا يوجد مسجلون في تخصص **${specializationName}** حتى الآن.`;
        } else {
            responseText = `**المسجلون في تخصص ${specializationName} (${users.length}):**\n\n`;
            users.forEach(user => {
                responseText += `**الاسم:** ${user.name}\n`;
                responseText += `**للتواصل:** @${user.telegram_username || 'غير محدد'}\n`; 
                responseText += `**التقنيات:** ${user.technologies || 'غير محدد'}\n`;
                responseText += "----------\n";
            });
        }
        bot.editMessageText(
            responseText,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    } catch (error) {
        bot.editMessageText(
            "حدث خطأ أثناء استرجاع البيانات.",
            { chat_id: chatId, message_id: messageId }
        );
    }
}


// *** المعالج الشامل للرسائل ***
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId] ? userStates[chatId].state : STATES.IDLE;
    const text = msg.text;

    // تجاهل الأوامر في معالج الرسائل العادية
    if (text && text.startsWith('/')) {
        return;
    }

    switch (state) {
        case STATES.ASK_NAME:
            handleAskName(msg);
            break;
        case STATES.ASK_USERNAME:
            handleAskUsername(msg);
            break;
        case STATES.ASK_TECHNOLOGIES:
            handleAskTechnologies(msg);
            break;
        case STATES.IDLE:
        default:
            if (!text.startsWith('/')) {
                bot.sendMessage(chatId, "أنا بوت لتسجيل بيانات التخصصات. استخدم الأمر /start للبدء، /view لعرض البيانات، أو /delete لحذف بياناتك.");
            }
            break;
    }
});

// *** معالج الـ Callback Query ***
bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;

    bot.answerCallbackQuery(callbackQuery.id);

    // معالجة اختيار التخصص
    if (userStates[chatId] && userStates[chatId].state === STATES.ASK_SPECIALIZATION) {
        handleSpecializationSelection(chatId, data, message.message_id);
    } 
    // معالجة عرض البيانات
    else if (data.startsWith('view_')) {
        handleViewDataCallback(chatId, data, message.message_id);
    }
    // معالجة تأكيد الحذف
     else if (userStates[chatId] && userStates[chatId].state === STATES.AWAIT_DELETE_CONFIRMATION) {
        handleDeleteConfirmation(chatId, callbackQuery.from.id, data, message.message_id);
    }
});


// --- التشغيل ---

connectDB(MONGO_URI).then(() => {
    console.log('Bot is ready to receive messages.');
});