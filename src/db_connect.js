// src/db_connect.js

const mongoose = require('mongoose');

/**
 * الاتصال بقاعدة بيانات MongoDB.
 * @param {string} uri - رابط اتصال MongoDB.
 */
async function connectDB(uri) {
    try {
        await mongoose.connect(uri);
        console.log('MongoDB connected successfully.');
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
}

module.exports = {
    connectDB
};