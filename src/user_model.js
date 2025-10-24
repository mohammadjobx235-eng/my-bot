// src/user_model.js

const mongoose = require('mongoose');

// تعريف نموذج المستخدم (Schema)
const userSchema = new mongoose.Schema({
    telegram_id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    telegram_username: { type: String, required: false }, 
    specialization: { type: String, required: true, enum: ['ذكاء اصطناعي', 'برمجيات', 'شبكات'] },
    technologies: { type: String }
});

const User = mongoose.model('User', userSchema);

/** * حفظ أو تحديث بيانات المستخدم في قاعدة البيانات. */
async function saveUserData(userId, name, username, specialization, technologies) {
    try {
        await User.findOneAndUpdate(
            { telegram_id: userId },
            { name, telegram_username: username, specialization, technologies }, 
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`User ${userId} data saved/updated.`);
    } catch (err) {
        console.error('Error saving user data:', err.message);
    }
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
    User 
};