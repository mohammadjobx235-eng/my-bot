// app.js
// ملف التشغيل الرئيسي للبوت باستخدام نظام Webhooks (خدمة ويب)

require('dotenv').config(); // تحميل متغيرات البيئة من .env
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// استيراد الدوال من الملفات المساعدة
const { connectDB } = require('./src/db_connect');
const { saveUserData, getUsersBySpecialization, deleteUserByTelegramId } = require('./src/user_model');
const { STATES, SPECIALIZATION_MAP } = require('./src/constants');

// --- إعدادات البوت والاتصال ---
const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
// المنفذ الذي سيستمع إليه الخادم (Render يحدد هذا تلقائياً)
const PORT = process.env.PORT || 3000; 
// يجب أن يكون هذا هو رابط الخدمة العام على Render
const WEBHOOK_URL = process.env.WEBHOOK_URL; 

// إنشاء مثيل للبوت بنظام Webhook
// نستخدم خاصية 'webHook: false' لتجنب إنشاء خادم داخلي، وسنستخدم Express بدلاً منه
const bot = new TelegramBot(TOKEN, { webHook: { port: PORT } });
const app = express();

// تخزين حالة المحادثة للمستخدمين
// {chatId: {state: 'ASK_NAME', data: {name: '', username: '', specialization: ''}}}
const userStates = {}; 

// --- إعدادات Express ---
app.use(express.json()); // ضروري لمعالجة تحديثات تلغرام المرسلة كـ JSON

// --- دوال البوت المساعدة ---

/**
 * دالة لتعديل رسالة مضمنة (Inline) لتجنب خطأ "not modified" الشائع.
 */
function editMessage(chatId, messageId, text, replyMarkup = null, parseMode = 'Markdown') {
    const options = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: parseMode
    };
    if (replyMarkup) {
        options.reply_markup = replyMarkup;
    }

    bot.editMessageText(text, options)
        .catch(error => {
            // يتم تجاهل خطأ "message is not modified"
            if (!error.response || !error.response.body || !error.response.body.description.includes('message is not modified')) {
                console.error('Error editing message:', error.message);
            }
        });
}

// --- معالجات الأوامر ---

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

/** * يبدأ عملية حذف البيانات بطلب تأكيد. */
bot.onText(/\/delete/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
        inline_keyboard: [
            [{ text: "نعم، متأكد من الحذف", callback_data: 'confirm_delete' }],
            [{ text: "إلغاء الحذف", callback_data: 'cancel_delete' }],
        ],
    };
    
    userStates[chatId] = { state: STATES.AWAIT_DELETE_CONFIRMATION, data: {} }; 

    bot.sendMessage(chatId,
        "**تنبيه:** هل أنت متأكد من أنك تريد حذف جميع بياناتك المسجلة؟ لا يمكن التراجع عن هذا الإجراء.",
        { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
});


/** * يبدأ عملية عرض البيانات باختيار التخصص. */
bot.onText(/\/view/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
        inline_keyboard: [
            [{ text: "عرض الذكاء الاصطناعي", callback_data: 'view_AI' }],
            [{ text: "عرض البرمجيات", callback_data: 'view_Software' }],
            [{ text: "عرض الشبكات", callback_data: 'view_Networks' }],
        ]
    };
    bot.sendMessage(chatId,
        "اختر التخصص الذي تود عرض بيانات المسجلين فيه:",
        { reply_markup: keyboard }
    );
});

// --- دوال معالجة الرسائل حسب الحالة ---

function handleAskName(msg) {
    const chatId = msg.chat.id;
    const userName = msg.text.trim();
    
    userStates[chatId].data.name = userName;
    userStates[chatId].state = STATES.ASK_USERNAME; 
    
    bot.sendMessage(chatId,
        `شكراً يا ${userName}. يرجى إدخال **معرّف التلغرام الخاص بك** (يبدأ بـ @) حتى يتمكن الآخرون من التواصل معك.".`,
        { parse_mode: 'Markdown' }
    );
}

function handleAskUsername(msg) {
    const chatId = msg.chat.id;
    const username = msg.text.trim(); 

    const cleanUsername = username === 'لا يوجد' ? 'لا يوجد' : (username.startsWith('@') ? username.substring(1) : username);
    
    userStates[chatId].data.username = cleanUsername; 
    userStates[chatId].state = STATES.ASK_SPECIALIZATION;

    const keyboard = {
        inline_keyboard: [
            [{ text: "ذكاء اصطناعي", callback_data: 'AI' }],
            [{ text: "برمجيات", callback_data: 'Software' }],
            [{ text: "شبكات", callback_data: 'Networks' }],
        ]
    };

    bot.sendMessage(chatId,
        `رائع، تم حفظ معرّفك. الآن، ما هو تخصصك الرئيسي؟`,
        { reply_markup: keyboard }
    );
}

async function handleAskTechnologies(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id; // Telegram User ID
    const technologies = msg.text.trim();
    
    if (!userStates[chatId] || !userStates[chatId].data.name || !userStates[chatId].data.specialization) {
        bot.sendMessage(chatId, "عذراً، يبدو أن عملية التسجيل لم تكتمل. يرجى البدء من جديد باستخدام /start.");
        userStates[chatId] = { state: STATES.IDLE, data: {} };
        return;
    }

    const { name, username, specialization } = userStates[chatId].data; 

    try {
        await saveUserData(userId, name, username, specialization, technologies);

        bot.sendMessage(chatId,
            `شكراً جزيلاً! تم حفظ بياناتك بنجاح.\n\n` +
            `**ملخص البيانات:**\n` +
            `الاسم: ${name}\n` +
            `**للتواصل:** @${username}\n` + 
            `التخصص: ${specialization}\n` +
            `التقنيات: ${technologies}\n\n` +
            `يمكنك استخدام الأمر /view لعرض بيانات المسجلين حسب التخصص.`
        );
    } catch (error) {
         bot.sendMessage(chatId, "حدث خطأ أثناء حفظ البيانات في قاعدة البيانات. يرجى المحاولة مرة أخرى.");
         console.error('Save Data Error:', error.message);
    }

    userStates[chatId] = { state: STATES.IDLE, data: {} };
}

// --- معالجات الـ Callback Query ---

function handleSpecializationSelection(chatId, specializationKey, messageId) {
    const specializationName = SPECIALIZATION_MAP[specializationKey];

    if (specializationName) {
        userStates[chatId].data.specialization = specializationName;
        userStates[chatId].state = STATES.ASK_TECHNOLOGIES;
        
        const newText = `✅ تم اختيار التخصص: **${specializationName}**.\n\n يرجى ادخال التقنيات التي تعلمتها او تعمل على تعلمها `;
        
        editMessage(chatId, messageId, newText);
    }
}

async function handleDeleteConfirmation(chatId, userId, data, messageId) {
    userStates[chatId] = { state: STATES.IDLE, data: {} }; 

    if (data === 'confirm_delete') {
        try {
            const deleted = await deleteUserByTelegramId(userId);

            if (deleted) {
                editMessage(chatId, messageId, "✅ تم حذف بياناتك من قاعدة البيانات بنجاح.");
            } else {
                editMessage(chatId, messageId, "⚠️ لم نتمكن من العثور على أي بيانات مسجلة باسمك لحذفها.");
            }
        } catch (error) {
            editMessage(chatId, messageId, "حدث خطأ أثناء محاولة حذف البيانات.");
            console.error('Delete Data Error:', error.message);
        }
    } else if (data === 'cancel_delete') {
        editMessage(chatId, messageId, "تم إلغاء عملية الحذف. بياناتك لم تتأثر.");
    }
}

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
            users.forEach((user, index) => {
                responseText += `${index + 1}. **الاسم:** ${user.name}\n`;
                
                const contact = user.telegram_username && user.telegram_username !== 'لا يوجد' 
                                ? `@${user.telegram_username}` 
                                : 'لا يوجد معرف تلغرام متاح';
                responseText += `**للتواصل:** ${contact}\n`; 
                responseText += `**التقنيات:** ${user.technologies || 'غير محدد'}\n`;
                responseText += "----------\n";
            });
        }

        editMessage(chatId, messageId, responseText);
        
    } catch (error) {
        editMessage(chatId, messageId, "حدث خطأ أثناء استرجاع البيانات.");
        console.error('View Data Error:', error.message);
    }
}


// *** المعالج الشامل للرسائل النصية (Message Handler) ***
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId] ? userStates[chatId].state : STATES.IDLE;
    const text = msg.text;

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
            if (text) {
                bot.sendMessage(chatId, "أنا بوت لتسجيل بيانات التخصصات. استخدم الأمر /start للبدء، /view لعرض البيانات، أو /delete لحذف بياناتك.");
            }
            break;
    }
});

// *** معالج الـ Callback Query (Inline Keyboard Handler) ***
bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    bot.answerCallbackQuery(callbackQuery.id);

    if (userStates[chatId] && userStates[chatId].state === STATES.ASK_SPECIALIZATION) {
        if (Object.keys(SPECIALIZATION_MAP).includes(data)) {
            handleSpecializationSelection(chatId, data, message.message_id);
        }
    } 
    else if (data.startsWith('view_')) {
        handleViewDataCallback(chatId, data, message.message_id);
    }
    else if (userStates[chatId] && userStates[chatId].state === STATES.AWAIT_DELETE_CONFIRMATION) {
        handleDeleteConfirmation(chatId, userId, data, message.message_id);
    }
});


// --- إعداد وتفعيل Webhook ---

// نقطة نهاية للتحقق من حالة الخادم
app.get('/', (req, res) => {
    res.send('Telegram Bot Webhook Server is running.');
});

// نقطة النهاية التي سيتصل بها تلغرام
const WEBHOOK_PATH = `/bot${TOKEN}`; // يجب أن يكون المسار معقداً لمنع الوصول العشوائي
app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); // يجب أن يرد الخادم برمز 200 لتيليجرام بسرعة
});

async function setupWebhookAndServer() {
    try {
        await connectDB(MONGO_URI);
        
        // تعيين Webhook
        const fullWebHookUrl = `${WEBHOOK_URL}${WEBHOOK_PATH}`;
        await bot.setWebHook(fullWebHookUrl);
        console.log(`Webhook set to: ${fullWebHookUrl}`);

        // بدء تشغيل Express Server
        app.listen(PORT, () => {
            console.log(`Express server listening on port ${PORT}`);
        });

    } catch (err) {
        console.error('Failed to initialize bot and server:', err);
        process.exit(1); 
    }
}

setupWebhookAndServer();
