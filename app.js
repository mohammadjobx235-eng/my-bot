const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// تحميل متغيرات البيئة من ملف .env
dotenv.config();

// ----------------------------------------------------
// متغيرات الإعداد (Configuration Variables)
// ----------------------------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// تهيئة البوت بدون بولينج (No Polling) - مطلوب للـ Webhook
const bot = new TelegramBot(BOT_TOKEN);

// ----------------------------------------------------
// تعاريف الحالة والنماذج (Models and States)
// ----------------------------------------------------

const STATES = {
    ASK_NAME: 'ASK_NAME', // طلب الاسم
    ASK_USERNAME: 'ASK_USERNAME', // طلب معرّف التلغرام (@username)
    ASK_SPECIALIZATION: 'ASK_SPECIALIZATION', // طلب اختيار التخصص
    ASK_TECHNOLOGIES: 'ASK_TECHNOLOGIES', // طلب إدخال قائمة التقنيات
    AWAIT_DELETE_CONFIRMATION: 'AWAIT_DELETE_CONFIRMATION', // انتظار تأكيد الحذف
    IDLE: 'IDLE', // حالة الانتظار أو الخمول
};

// النموذج (User Model)
const UserSchema = new mongoose.Schema({
    // نستخدم telegramId (msg.from.id) كمعرّف فريد
    telegramId: { type: Number, required: true, unique: true }, 
    name: String,
    telegram_username: String, // معرّف التلغرام (@اسم_المستخدم)
    specialization: String,
    technologies: String, // سلسلة نصية واحدة للتقنيات
    registration_date: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// لتخزين حالة المستخدمين محلياً
const userStates = {};

const SPECIALIZATION_MAP = {
    AI: "ذكاء اصطناعي",
    Software: "برمجيات",
    Networks: "شبكات"
};

// ----------------------------------------------------
// دوال قاعدة البيانات (Database Functions)
// ----------------------------------------------------

async function connectDB(uri) {
    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
        });
        console.log('MongoDB connected successfully. ✅');
    } catch (err) {
        console.error('🔴 فشل الاتصال بقاعدة البيانات. تحقق من URI و IP Whitelist.', err.message);
        // رمي الخطأ للخارج لمنع تشغيل الخادم
        throw err; 
    }
}

// دالة حفظ بيانات المستخدم أو تحديثها باستخدام telegramId
async function saveUserData(telegramId, name, telegram_username, specialization, technologies) {
    try {
        const result = await User.findOneAndUpdate(
            { telegramId },
            { 
                $set: { 
                    name, 
                    telegram_username, 
                    specialization, 
                    technologies 
                } 
            },
            { upsert: true, new: true }
        );
        return result;
    } catch (error) {
        console.error('Error saving user data:', error.message);
    }
}

// دالة حذف بيانات المستخدم بواسطة telegramId
async function deleteUserByTelegramId(telegramId) {
    try {
        const result = await User.deleteOne({ telegramId });
        return result.deletedCount > 0;
    } catch (error) {
        console.error('Error deleting user data:', error.message);
        return false;
    }
}

// دالة استرداد بيانات المستخدمين حسب التخصص
async function getUsersBySpecialization(specialization) {
    try {
        return await User.find({ specialization }).sort({ name: 1 });
    } catch (error) {
        console.error('Error retrieving users by specialization:', error.message);
        return [];
    }
}

// ----------------------------------------------------
// دوال البوت (Bot Handlers - Message & Callback Logic)
// ----------------------------------------------------

/** معالجة اختيار التخصص. */
function handleSpecializationSelection(chatId, specializationKey, messageId) {
    const specializationName = SPECIALIZATION_MAP[specializationKey];

    if (specializationName) {
        userStates[chatId].data.specialization = specializationName;
        userStates[chatId].state = STATES.ASK_TECHNOLOGIES;
        
        bot.editMessageText(
            `✅ تم اختيار التخصص: **${specializationName}**.\n\n` +
            "الآن، يرجى إدخال قائمة بالتقنيات التي تعلمتها او تتعلم عليها .",
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }
}

/** معالجة ردود تأكيد حذف البيانات. */
async function handleDeleteConfirmation(chatId, telegramId, data, messageId) {
    userStates[chatId] = { state: STATES.IDLE, data: {} }; 

    if (data === 'confirm_delete') {
        const deleted = await deleteUserByTelegramId(telegramId);

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

/** معالجة ردود عرض البيانات. */
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
                // تأكد من استخدام telegram_username المخزن في قاعدة البيانات
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
        console.error("Error viewing data:", error);
        bot.editMessageText(
            "حدث خطأ أثناء استرجاع البيانات.",
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// *** المعالج الشامل للرسائل النصية ***
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const state = userStates[chatId] ? userStates[chatId].state : STATES.IDLE;
    const text = msg.text;

    // تجاهل الأوامر في معالج الرسائل العادية
    if (text && text.startsWith('/')) {
        return;
    }

    switch (state) {
        case STATES.ASK_NAME:
            userStates[chatId].data.name = text.trim();
            userStates[chatId].state = STATES.ASK_USERNAME; 
            
            bot.sendMessage(chatId,
                `شكراً يا ${text.trim()}. يرجى إدخال **معرّف التلغرام الخاص بك** (يبدأ بـ @ أو اسم المستخدم فقط) حتى يتمكن الآخرون من التواصل معك.`,
                { parse_mode: 'Markdown' }
            );
            break;
            
        case STATES.ASK_USERNAME:
            // تنظيف معرّف التلغرام
            const username = text.trim().startsWith('@') ? text.trim().substring(1) : text.trim(); 
            userStates[chatId].data.telegram_username = username; 
            
            userStates[chatId].state = STATES.ASK_SPECIALIZATION;

            const keyboard = [
                [{ text: "ذكاء اصطناعي", callback_data: 'AI' }],
                [{ text: "برمجيات", callback_data: 'Software' }],
                [{ text: "شبكات", callback_data: 'Networks' }],
            ];
            bot.sendMessage(chatId,
                `رائع، تم حفظ معرّفك. الآن، ما هو تخصصك الرئيسي؟`,
                { reply_markup: { inline_keyboard: keyboard } }
            );
            break;

        case STATES.ASK_TECHNOLOGIES:
            const technologies = text.trim();
            
            const { name, telegram_username, specialization } = userStates[chatId].data; 

            // حفظ البيانات في قاعدة البيانات
            await saveUserData(telegramId, name, telegram_username, specialization, technologies);

            bot.sendMessage(chatId,
                `شكراً جزيلاً! تم حفظ بياناتك بنجاح.\n` +
                `الاسم: ${name}\n` +
                `**معرّف التلغرام:** @${telegram_username}\n` + 
                `التخصص: ${specialization}\n` +
                `التقنيات: ${technologies}\n\n` +
                `يمكنك استخدام الأمر /view لعرض بيانات المسجلين حسب التخصص.`
            );
            userStates[chatId] = { state: STATES.IDLE, data: {} };
            break;

        case STATES.IDLE:
        default:
            // رسالة افتراضية عند الخمول وعدم وجود أمر
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
    const telegramId = callbackQuery.from.id; // استخدام معرّف المرسل من الـ callback
    const data = callbackQuery.data;

    bot.answerCallbackQuery(callbackQuery.id); // إغلاق الإشعار البسيط

    // معالجة اختيار التخصص (ضمن سير تسجيل البيانات)
    if (userStates[chatId] && userStates[chatId].state === STATES.ASK_SPECIALIZATION) {
        handleSpecializationSelection(chatId, data, message.message_id);
    } 
    // معالجة عرض البيانات
    else if (data.startsWith('view_')) {
        handleViewDataCallback(chatId, data, message.message_id);
    }
    // معالجة تأكيد الحذف
    else if (userStates[chatId] && userStates[chatId].state === STATES.AWAIT_DELETE_CONFIRMATION) {
        handleDeleteConfirmation(chatId, telegramId, data, message.message_id);
    }
});


// ----------------------------------------------------
// إعداد خادم Express والـ Webhook
// ----------------------------------------------------

const app = express();
const WEBHOOK_URL_PATH = `/${BOT_TOKEN}`;

// معالج JSON لـ Express
app.use(express.json());

// 1. معالج مسار الـ Webhook (لاستقبال الرسائل من تيليجرام)
app.post(WEBHOOK_URL_PATH, (req, res) => {
    bot.processUpdate(req.body); 
    res.sendStatus(200); 
});

// 2. مسار افتراضي
app.get('/', (req, res) => {
    res.send('Telegram Bot Webhook Service is running.');
});

// 3. بدء الاتصال بقاعدة البيانات ثم تشغيل الخادم
async function startServer() {
    try {
        await connectDB(MONGO_URI);
        
        app.listen(PORT, () => {
            console.log(`Express server is listening on port ${PORT}`);
            
            const fullWebhookUrl = `${process.env.RENDER_EXTERNAL_URL || 'YOUR_PUBLIC_URL_HERE'}${WEBHOOK_URL_PATH}`;

            if (process.env.RENDER_EXTERNAL_URL) {
                bot.setWebHook(fullWebhookUrl)
                    .then(() => console.log(`Webhook successfully set to: ${fullWebhookUrl}`))
                    .catch(err => console.error('Error setting webhook:', err));
            } else {
                console.warn('RENDER_EXTERNAL_URL is not defined. Webhook not set. Please set it manually for production.');
            }
        });
    } catch (error) {
        console.error('🔴 فشل حرج: تعذر الاتصال بقاعدة البيانات. إيقاف تشغيل التطبيق.');
        // إيقاف تشغيل العملية إذا فشل الاتصال بقاعدة البيانات
        process.exit(1); 
    }
}

startServer();
