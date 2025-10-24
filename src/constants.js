// src/constants.js

const STATES = {
    IDLE: 'IDLE',
    ASK_NAME: 'ASK_NAME',
    ASK_USERNAME: 'ASK_USERNAME', 
    ASK_SPECIALIZATION: 'ASK_SPECIALIZATION',
    ASK_TECHNOLOGIES: 'ASK_TECHNOLOGIES',
    AWAIT_DELETE_CONFIRMATION: 'AWAIT_DELETE_CONFIRMATION' 
};

const SPECIALIZATION_MAP = {
    'AI': 'ذكاء اصطناعي',
    'Software': 'برمجيات',
    'Networks': 'شبكات'
};

module.exports = {
    STATES,
    SPECIALIZATION_MAP
};