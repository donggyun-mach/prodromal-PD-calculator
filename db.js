const mysql = require('mysql2/promise');

async function initializeDatabase() {
    try {
        const db = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'question_ppd'
        });
        console.log('Database connected successfully');
        return db;
    } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
    }
}

module.exports = initializeDatabase;
