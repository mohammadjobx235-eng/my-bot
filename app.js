// app.js

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
// Render سيقوم بتحديد الـ PORT تلقائيًا، أو نستخدم 3000 كافتراضي
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// تهيئة البوت
const bot = new TelegramBot(BOT_TOKEN);

// ----------------------------------------------------
// تعاريف الحالة والنماذج (Models and States)
// ----------------------------------------------------
const STATES = {
    AWAITING_NAME: 'awaiting_name',
    AWAITING_USERNAME: 'awaiting_username', // حالة جديدة لطلب معرف التلجرام
    AWAITING_SPECIALIZATION_SELECTION: 'awaiting_specialization_selection', // انتظار اختيار التخصص من الأزرار
    AWAITING_TECHNOLOGIES: 'awaiting_technologies',
    NONE: 'none',
};

// نموذج المستخدم (User Model)
const UserSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true },
    name: String,
    username: String, // حقل جديد لمعرف التلجرام (بدون @)
    specialization: String, // سيتم تخزين الاسم بالعربية (مثلاً: "شبكات (Networking)")
    technologies: [String],
    is_admin: { type: Boolean, default: false }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// لتخزين حالة المستخدمين محلياً
const userStates = {};

const SPECIALIZATION_MAP = {
    networking: "شبكات (Networking)",
    software: "برمجيات (Software Development)",
    ai: "ذكاء اصطناعي (AI)"
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
        // إذا كان اسم المستخدم يبدأ بـ @ في البيانات، قم بإزالته للتخزين النظيف
        if (data.username && data.username.startsWith('@')) {
            data.username = data.username.substring(1);
        }

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
                [{ text: SPECIALIZATION_MAP.networking, callback_data: 'spec_networking' }],
                [{ text: SPECIALIZATION_MAP.software, callback_data: 'spec_software' }],
                [{ text: SPECIALIZATION_MAP.ai, callback_data: 'spec_ai' }],
            ],
        },
    };
    bot.sendMessage(chatId, "الآن، من فضلك اختر تخصصك:", options);
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

        const usernameDisplay = user.username ? `@${user.username}` : 'غير مسجل';
        const message = `
**بياناتك المسجلة:**
**الاسم:** ${user.name || 'غير مسجل'}
**معرف التلجرام:** ${usernameDisplay}
**التخصص:** ${user.specialization || 'غير مسجل'}
**التقنيات:** ${user.technologies && user.technologies.length > 0 ? user.technologies.join(', ') : 'غير مسجلة'}

**لحذف بياناتك، استخدم الأمر /delete**
        `;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
}

// دالة لمعالجة عرض جميع المستخدمين حسب التخصص
async function handleListUsers(chatId) {
    try {
        const allUsers = await User.find({});
        if (allUsers.length === 0) {
            return bot.sendMessage(chatId, "لا يوجد مستخدمون مسجلون حالياً.");
        }

        const categorizedUsers = {};
        Object.values(SPECIALIZATION_MAP).forEach(spec => {
            categorizedUsers[spec] = [];
        });

        allUsers.forEach(user => {
            const spec = user.specialization || 'تخصص غير محدد';
            // التأكد من أن التخصص موجود في القائمة أو إضافته إذا كان مخصصاً
            if (!categorizedUsers[spec]) {
                categorizedUsers[spec] = [];
            }
            categorizedUsers[spec].push(user);
        });

        let response = "**قائمة المستخدمين المسجلين حسب التخصص:**\n\n";
        let hasUsers = false;

        for (const spec in categorizedUsers) {
            const usersInSpec = categorizedUsers[spec];
            if (usersInSpec.length > 0) {
                hasUsers = true;
                response += `**-- ${spec} (${usersInSpec.length}) --**\n`;
                usersInSpec.forEach(user => {
                    const usernameDisplay = user.username ? `@${user.username}` : 'معرف غير مسجل';
                    const technologiesDisplay = user.technologies && user.technologies.length > 0
                        ? `(التقنيات: ${user.technologies.join(', ')})`
                        : '';
                    response += `• ${user.name} | ${usernameDisplay} ${technologiesDisplay}\n`;
                });
                response += '\n';
            }
        }

        if (!hasUsers) {
             return bot.sendMessage(chatId, "لا يوجد مستخدمون مسجلون حالياً.");
        }

        bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error listing users:', error.message);
        bot.sendMessage(chatId, "حدث خطأ أثناء محاولة عرض قائمة المستخدمين.");
    }
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
        // التأكد من وجود حالة المستخدم وتحديث البيانات
        if (!userStates[chatId] || userStates[chatId].state !== STATES.AWAITING_SPECIALIZATION_SELECTION) {
             return bot.sendMessage(chatId, 'عفواً، يرجى البدء باستخدام /start أولاً.');
        }

        userStates[chatId].data.specialization = specializationName;
        userStates[chatId].state = STATES.AWAITING_TECHNOLOGIES; // الحالة التالية: انتظار التقنيات

        // تعديل الرسالة لضمان التغيير وتجنب خطأ "not modified"
        bot.editMessageText(
            `✅ تم اختيار التخصص: **${specializationName}**.\n\n` +
            "أخيراً، يرجى إدخال قائمة بالتقنيات التي تعمل عليها أو تتعلمها (مثل: Cisco, Python, TensorFlow). **افصل بينها بفاصلة**.",
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
    }
}

function handleDeleteCommand(chatId) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "أؤكد الحذف", callback_data: 'confirm_delete' }],
                [{ text: "إلغاء", callback_data: 'cancel_delete' }],
            ],
        },
        parse_mode: 'Markdown'
    };
    bot.sendMessage(chatId, '**تأكيد الحذف:** هل أنت متأكد من رغبتك في حذف جميع بياناتك؟ لا يمكن التراجع عن هذا الإجراء.', options);
}

async function handleFinalDelete(chatId, messageId) {
    try {
        const result = await User.deleteOne({ chatId });

        if (result.deletedCount > 0) {
            delete userStates[chatId];
            bot.editMessageText('تم حذف بياناتك بالكامل بنجاح. يمكنك البدء من جديد باستخدام /start.', {
                chat_id: chatId,
                message_id: messageId // تعديل رسالة التأكيد الأصلية
            });
        } else {
             bot.editMessageText('لم يتم العثور على بيانات لحذفها.', {
                chat_id: chatId,
                message_id: messageId
            });
        }
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
    if (text === '/list') { // الأمر الجديد لعرض قائمة المستخدمين حسب التخصص
        return handleListUsers(chatId);
    }
    if (text === '/delete') { // الأمر الجديد للحذف
        return handleDeleteCommand(chatId);
    }

    // معالجة حالات إدخال البيانات
    const userState = userStates[chatId];
    if (!userState || userState.state === STATES.NONE) {
        return bot.sendMessage(chatId, "يرجى استخدام الأمر /start للتسجيل، /view لعرض بياناتك، /list لعرض قائمة المسجلين، أو /delete للحذف.");
    }

    switch (userState.state) {
        case STATES.AWAITING_NAME:
            userState.data.name = text;
            userState.state = STATES.AWAITING_USERNAME;
            bot.sendMessage(chatId, "شكراً لك. الآن، يرجى إدخال **معرف التلجرام الخاص بك (Username)**. إذا لم يكن لديك، اكتب 'لا يوجد'.");
            break;

        case STATES.AWAITING_USERNAME:
            // تنظيف معرف المستخدم
            userState.data.username = text === 'لا يوجد' ? null : (text.startsWith('@') ? text.substring(1) : text);
            userState.state = STATES.AWAITING_SPECIALIZATION_SELECTION;
            sendSpecializationKeyboard(chatId);
            break;

        // حالة انتظار اختيار التخصص يتم التعامل معها في callback_query

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
                    bot.sendMessage(chatId, "✅ تم حفظ بياناتك بنجاح! شكراً لك. يمكنك استخدام /view لعرضها أو /list لعرض قائمة المسجلين.");
                } else {
                    bot.sendMessage(chatId, "حدث خطأ في حفظ البيانات. يرجى المحاولة مرة أخرى.");
                }
                delete userStates[chatId];
            }).catch(error => {
                console.error('Error in final save:', error);
                bot.sendMessage(chatId, "حدث خطأ غير متوقع أثناء الحفظ. يرجى البدء من جديد.");
            });
            break;

        default:
            // حالة لا يجب الوصول إليها، لإعادة التوجيه الآمن
            bot.sendMessage(chatId, "يرجى إكمال التسجيل أو استخدام /start للبدء من جديد.");
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
