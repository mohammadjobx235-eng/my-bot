// app.js

const express = require('express'); // 👈 إضافة Express
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// تحميل متغيرات البيئة من ملف .env
dotenv.config();

// ----------------------------------------------------
// متغيرات الإعداد (Configuration Variables)
// ----------------------------------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
// Render سيقوم بتحديد الـ PORT تلقائيًا، أو نستخدم 3000 كافتراضي
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// تهيئة البوت بدون بولينج (No Polling)
// يجب إزالة 'polling: true' إذا كنت قد أضفتها سابقاً
const bot = new TelegramBot(BOT_TOKEN);

// تعاريف الحالة والنماذج (Models and States)
const STATES = {
    AWAITING_NAME: 'awaiting_name',
    AWAITING_AGE: 'awaiting_age',
    AWAITING_SPECIALIZATION: 'awaiting_specialization',
    ASK_TECHNOLOGIES: 'ask_technologies',
    AWAITING_TECHNOLOGIES: 'awaiting_technologies',
    NONE: 'none',
};

// نموذج المستخدم (User Model - يجب أن يكون في ملف منفصل عادةً)
const UserSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true },
    name: String,
    age: Number,
    specialization: String,
    technologies: [String],
    is_admin: { type: Boolean, default: false }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// لتخزين حالة المستخدمين محلياً (يجب استبدالها بـ Redis أو قاعدة بيانات في الإنتاج)
const userStates = {}; 

const SPECIALIZATION_MAP = {
    front_end: "واجهات أمامية (Front-end)",
    back_end: "واجهات خلفية (Back-end)",
    full_stack: "مطور شامل (Full-Stack)",
    devops: "إدارة الأنظمة (DevOps)"
};


// ----------------------------------------------------
// دوال قاعدة البيانات (Database Functions)
// ----------------------------------------------------

// دالة الاتصال بقاعدة البيانات
async function connectDB(uri) {
    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
        });
        console.log('MongoDB connected successfully. ✅');
    } catch (err) {
        console.error('MongoDB connection error: MongooseServerSelectionError. تحقق من MONGO_URI وإعدادات IP Whitelist في Atlas.', err.message);
    }
}

// دالة حفظ بيانات المستخدم أو تحديثها
async function saveUserData(chatId, data) {
    try {
        const result = await User.findOneAndUpdate(
            { chatId },
            { $set: data },
            { upsert: true, new: true }
        );
        return result;
    } catch (error) {
        console.error('Error saving user data:', error.message);
    }
}

// دالة استرداد بيانات مستخدم واحد
async function getUserData(chatId) {
    try {
        return await User.findOne({ chatId });
    } catch (error) {
        console.error('Error retrieving user data:', error.message);
    }
}

// ----------------------------------------------------
// دوال البوت (Bot Handlers)
// ----------------------------------------------------

function sendSpecializationKeyboard(chatId) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "واجهات أمامية (Front-end)", callback_data: 'spec_front_end' }],
                [{ text: "واجهات خلفية (Back-end)", callback_data: 'spec_back_end' }],
                [{ text: "مطور شامل (Full-Stack)", callback_data: 'spec_full_stack' }],
                [{ text: "إدارة الأنظمة (DevOps)", callback_data: 'spec_devops' }],
            ],
        },
    };
    bot.sendMessage(chatId, "الآن، من فضلك اختر تخصصك التقني:", options);
}

function handleStart(chatId) {
    userStates[chatId] = { state: STATES.AWAITING_NAME, data: { chatId } };
    bot.sendMessage(chatId, "مرحباً! لنبدأ عملية التسجيل. ما هو اسمك الكامل؟");
}

function handleViewData(chatId) {
    getUserData(chatId).then(user => {
        if (!user) {
            return bot.sendMessage(chatId, "لم يتم العثور على بيانات مسجلة لك. يرجى البدء باستخدام /start.");
        }
        const message = `
**بياناتك المسجلة:**
**الاسم:** ${user.name || 'غير مسجل'}
**العمر:** ${user.age || 'غير مسجل'}
**التخصص:** ${user.specialization || 'غير مسجل'}
**التقنيات:** ${user.technologies && user.technologies.length > 0 ? user.technologies.join(', ') : 'غير مسجلة'}
        `;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "حذف بياناتي", callback_data: 'delete_data' }],
                ],
            },
            parse_mode: 'Markdown'
        };

        bot.sendMessage(chatId, message, options);
    });
}

// دالة معالجة ردود الـ Callback (مثل الضغط على زر)
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    bot.answerCallbackQuery(query.id); // إغلاق الإشعار البسيط

    if (data.startsWith('spec_')) {
        const specializationKey = data.substring(5);
        handleSpecializationSelection(chatId, specializationKey, messageId);
    } else if (data === 'delete_data') {
        handleDeleteConfirmation(chatId, messageId);
    } else if (data === 'confirm_delete') {
        handleFinalDelete(chatId, messageId);
    } else if (data === 'cancel_delete') {
        bot.editMessageText('تم إلغاء عملية الحذف.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
});

function handleSpecializationSelection(chatId, specializationKey, messageId) {
    const specializationName = SPECIALIZATION_MAP[specializationKey];

    if (specializationName) {
        userStates[chatId].data.specialization = specializationName;
        userStates[chatId].state = STATES.ASK_TECHNOLOGIES;
        
        // تعديل الرسالة لضمان التغيير وتجنب خطأ "not modified"
        bot.editMessageText(
            `✅ تم اختيار التخصص: **${specializationName}**.\n\n` +
            "الآن، يرجى إدخال قائمة بالتقنيات التي تعمل عليها (مثل: React, Node.js, Python). افصل بينها بفاصلة.",
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }
}

function handleDeleteConfirmation(chatId, messageId) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "أؤكد الحذف", callback_data: 'confirm_delete' }],
                [{ text: "إلغاء", callback_data: 'cancel_delete' }],
            ],
        },
        parse_mode: 'Markdown'
    };
    bot.editMessageText('**تأكيد الحذف:** هل أنت متأكد من رغبتك في حذف جميع بياناتك؟ لا يمكن التراجع عن هذا الإجراء.', {
        chat_id: chatId,
        message_id: messageId,
        ...options
    });
}

async function handleFinalDelete(chatId, messageId) {
    try {
        await User.deleteOne({ chatId });
        delete userStates[chatId];
        
        bot.editMessageText('تم حذف بياناتك بالكامل بنجاح. يمكنك البدء من جديد باستخدام /start.', {
            chat_id: chatId,
            message_id: messageId
        });
    } catch (error) {
        bot.sendMessage(chatId, 'حدث خطأ أثناء محاولة حذف البيانات.');
        console.error('Error deleting user data:', error.message);
    }
}


// دالة معالجة الرسائل النصية
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // معالجة الأوامر
    if (text === '/start') {
        return handleStart(chatId);
    }
    if (text === '/view') {
        return handleViewData(chatId);
    }

    // معالجة حالات إدخال البيانات
    const userState = userStates[chatId];
    if (!userState || userState.state === STATES.NONE) {
        return bot.sendMessage(chatId, "يرجى استخدام الأمر /start للبدء أو /view لعرض بياناتك.");
    }

    switch (userState.state) {
        case STATES.AWAITING_NAME:
            userState.data.name = text;
            userState.state = STATES.AWAITING_AGE;
            bot.sendMessage(chatId, "ما هو عمرك؟ (يرجى إدخال رقم)");
            break;

        case STATES.AWAITING_AGE:
            const age = parseInt(text);
            if (isNaN(age) || age <= 0 || age > 100) {
                return bot.sendMessage(chatId, "عفواً، يرجى إدخال رقم صحيح للعمر.");
            }
            userState.data.age = age;
            userState.state = STATES.AWAITING_SPECIALIZATION;
            sendSpecializationKeyboard(chatId);
            break;

        // حالة انتظار اختيار التخصص يتم التعامل معها في callback_query
        
        case STATES.ASK_TECHNOLOGIES: // هذه الحالة تسمح للمستخدم بإدخال نص بعد اختيار التخصص
        case STATES.AWAITING_TECHNOLOGIES:
            const technologiesArray = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
            
            if (technologiesArray.length === 0) {
                return bot.sendMessage(chatId, "يرجى إدخال قائمة بالتقنيات مفصولة بفاصلة.");
            }

            userState.data.technologies = technologiesArray;
            userState.state = STATES.NONE;

            // حفظ البيانات في قاعدة البيانات
            saveUserData(chatId, userState.data).then(savedUser => {
                if (savedUser) {
                    bot.sendMessage(chatId, "تم حفظ بياناتك بنجاح! شكراً لك.");
                } else {
                    bot.sendMessage(chatId, "حدث خطأ في حفظ البيانات. يرجى المحاولة مرة أخرى.");
                }
                delete userStates[chatId];
            });
            break;
    }
});


// ----------------------------------------------------
// إعداد خادم Express والـ Webhook
// ----------------------------------------------------

const app = express();
const WEBHOOK_URL_PATH = `/${BOT_TOKEN}`; // مسار سري للـ Webhook (يستخدم التوكن)

// معالج JSON لـ Express
app.use(express.json());

// 1. معالج مسار الـ Webhook (لاستقبال الرسائل من تيليجرام)
app.post(WEBHOOK_URL_PATH, (req, res) => {
    // تمرير تحديث تيليجرام إلى معالج البوت
    bot.processUpdate(req.body); 
    // يجب الرد بـ 200 OK بسرعة لتجنب تكرار إرسال الرسالة من تيليجرام
    res.sendStatus(200); 
});

// 2. مسار افتراضي (للتأكد من أن الخدمة تعمل)
app.get('/', (req, res) => {
    res.send('Telegram Bot Webhook Service is running.');
});

// 3. بدء الاتصال بقاعدة البيانات ثم تشغيل الخادم
connectDB(MONGO_URI).then(() => {
    app.listen(PORT, () => {
        console.log(`Express server is listening on port ${PORT}`);
        
        // تعيين الـ Webhook على تيليجرام
        // Render يحدد متغير البيئة RENDER_EXTERNAL_URL الذي يحتوي على رابط النشر العام
        const fullWebhookUrl = `${process.env.RENDER_EXTERNAL_URL}${WEBHOOK_URL_PATH}`;

        if (process.env.RENDER_EXTERNAL_URL) {
            bot.setWebHook(fullWebhookUrl)
                .then(() => console.log(`Webhook successfully set to: ${fullWebhookUrl}`))
                .catch(err => console.error('Error setting webhook:', err));
        } else {
            console.warn('RENDER_EXTERNAL_URL is not defined. Webhook not set.');
        }
    });
});