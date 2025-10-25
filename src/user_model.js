// src/user_model.js
// تم تعديل هذا الملف ليدعم الثبات (Persistence) عن طريق تخزين حالة المستخدم في MongoDB
// هذا يمنع البوت من "الانهيار" إذا تمت إعادة تشغيله (مثلاً على Render)

const mongoose = require('mongoose');
// يجب استيراد STATES من constants.js
const { STATES } = require('./constants'); 

// تعريف نموذج المستخدم (Schema)
const userSchema = new mongoose.Schema({
    telegram_id: { type: Number, required: true, unique: true },
    // تم تغيير 'required' إلى false لهذه الحقول، لأنها تحفظ فقط عند اكتمال التسجيل
    name: { type: String, required: false }, 
    telegram_username: { type: String, required: false }, 
    specialization: { type: String, required: false, enum: ['ذكاء اصطناعي', 'برمجيات', 'شبكات'] },
    technologies: { type: String, required: false },
    
    // **الحقول الجديدة لضمان ثبات حالة المحادثة (Persistence)**
    current_state: { type: String, required: true, default: STATES.IDLE },
    registration_data: { type: mongoose.Schema.Types.Mixed, required: true, default: {} } // بيانات مؤقتة لعملية التسجيل الجارية
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

/**
 * دالة حفظ بيانات المستخدم النهائية بعد اكتمال عملية التسجيل.
 * هذه الدالة أيضاً تعيد ضبط حالة المستخدم إلى IDLE.
 */
async function saveUserData(telegramId, name, username, specialization, technologies) {
    try {
        const update = {
            $set: { 
                name, 
                telegram_username: username, 
                specialization, 
                technologies,
                current_state: STATES.IDLE, // إعادة ضبط الحالة بعد الحفظ
                registration_data: {} // مسح البيانات المؤقتة
            } 
        };
        const result = await User.findOneAndUpdate(
            { telegram_id: telegramId },
            update,
            { upsert: true, new: true } 
        );
        return result;
    } catch (error) {
        console.error('Error saving final user data:', error.message);
        throw error; 
    }
}

/**
 * دالة لجلب حالة المستخدم وبياناته المؤقتة أو إنشاء سجل جديد إذا لم يكن موجوداً.
 */
async function getOrCreateUser(telegramId) {
    const user = await User.findOneAndUpdate(
        { telegram_id: telegramId },
        {}, // لا يوجد تحديث، فقط جلب أو إدخال
        { 
            upsert: true, 
            new: true, 
            setDefaultsOnInsert: true, // لضمان تعيين القيم الافتراضية عند الإنشاء
            select: 'telegram_id current_state registration_data' 
        }
    );
    // إرجاع كائن مبسط للاستخدام في app.js
    return {
        id: user.telegram_id,
        state: user.current_state,
        data: user.registration_data || {} // التأكد من وجود كائن بيانات
    };
}

/**
 * دالة لتحديث حالة المستخدم وبيانات التسجيل المؤقتة.
 */
async function updateUserState(telegramId, newState, newRegistrationData) {
    const update = {
        current_state: newState
    };
    if (newRegistrationData !== undefined) {
        update.registration_data = newRegistrationData;
    }
    
    await User.updateOne(
        { telegram_id: telegramId },
        { $set: update },
        { upsert: true } // يستخدم upsert للتأكد من إنشاء السجل إذا لم يكن موجوداً
    );
}

/** * استرجاع جميع المستخدمين لتخصص معين. */
async function getUsersBySpecialization(specialization) {
    try {
        const users = await User.find({ specialization }).select('name telegram_username technologies').exec(); 
        return users;
    } catch (err) {
        console.error('Error retrieving user data:', err.message);
        return [];
    }
}

/** * حذف مستند المستخدم من قاعدة البيانات بناءً على Telegram ID. */
async function deleteUserByTelegramId(userId) {
    try {
        const result = await User.deleteOne({ telegram_id: userId });
        return result.deletedCount > 0;
    } catch (err) {
        console.error('Error deleting user data:', err.message);
        return false;
    }
}

module.exports = {
    saveUserData,
    getUsersBySpecialization,
    deleteUserByTelegramId,
    getOrCreateUser, 
    updateUserState 
};
