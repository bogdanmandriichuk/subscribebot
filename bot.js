// Load environment variables from .env file
require('dotenv').config();

// Import necessary modules
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path'); // Used for resolving file paths
const fs = require('fs'); // Used for reading the file system

// Define the path to the SQLite database file
const dbPath = path.resolve(__dirname, 'bot.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Initialize the Telegram bot with the token from environment variables
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- Database Initialization (runs once on bot start to ensure tables exist) ---
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            telegram_id INTEGER UNIQUE NOT NULL,
            current_key_id INTEGER,
            last_signal_timestamp TEXT,
            signal_count_hourly INTEGER DEFAULT 0,
            FOREIGN KEY (current_key_id) REFERENCES access_keys(id)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS access_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_value TEXT UNIQUE NOT NULL,
            expires_at TEXT,
            created_by_admin_id INTEGER,
            is_active BOOLEAN DEFAULT TRUE,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
});

// --- Constants ---
// Replace with your Telegram user IDs. These users will have access to the /generate_key command.
const ADMIN_IDS = [7263932570, 987654321]; // IMPORTANT: Replace with your actual admin IDs!
const HOURLY_SIGNAL_LIMIT = 10;

// Path to the directory containing "Jumps ⬆️" images.
// Ensure your images are located in this 'images/' folder in your project root.
const IMAGES_DIR = path.resolve(__dirname, 'images');


// --- Helper Functions ---

/**
 * Generates a unique alphanumeric key string.
 * @returns {string} A unique key.
 */
function generateUniqueKey() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Calculates the expiry date for a key based on a given duration.
 * @param {string} duration - The duration string ('week', 'month', 'forever').
 * @returns {string|null} The expiry date in ISO 8601 format, or null if 'forever' or invalid duration.
 */
function calculateExpiryDate(duration) {
    const now = new Date();
    let expiryDate = null;
    switch (duration) {
        case 'week':
            expiryDate = new Date(now.setDate(now.getDate() + 7));
            break;
        case 'month':
            expiryDate = new Date(now.setMonth(now.getMonth() + 1));
            break;
        case 'forever':
            // expiryDate remains null for "forever"
            break;
        default:
            return null; // Invalid duration
    }
    return expiryDate ? expiryDate.toISOString() : null;
}

/**
 * Gets a random image file path from the IMAGES_DIR.
 * Filters for common image file extensions.
 * @returns {string|null} The full path to a random image, or null if no images are found.
 */
function getRandomImagePath() {
    try {
        const files = fs.readdirSync(IMAGES_DIR);
        console.log('Files found in images directory:', files); // <-- DIAGNOSTIC LOG

        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
        });

        console.log('Filtered image files:', imageFiles); // <-- DIAGNOSTIC LOG

        if (imageFiles.length === 0) {
            console.warn('No image files found in the images directory.');
            return null;
        }

        const randomIndex = Math.floor(Math.random() * imageFiles.length);
        const selectedImage = imageFiles[randomIndex];
        console.log('Selected random image:', selectedImage); // <-- DIAGNOSTIC LOG

        return path.join(IMAGES_DIR, selectedImage);
    } catch (error) {
        console.error('Error reading images directory:', error);
        return null;
    }
}

// --- Keyboard Markup for common user actions ---
const mainKeyboard = Markup.inlineKeyboard([
    Markup.button.callback('Give Signal', 'give_signal'),
    Markup.button.callback('Subscription Info', 'subscription_info')
]);

// --- Keyboard for expired key messages, with contact admin button ---
const expiredKeyKeyboard = Markup.inlineKeyboard([
    Markup.button.url('Contact Admin', 'https://t.me/HANS_LANDA1')
]);


// --- Middleware to check if user exists in DB and create if not ---
// This middleware runs for every incoming message and ensures the user is registered in the database.
bot.use(async (ctx, next) => {
    if (ctx.from) {
        db.get('SELECT * FROM users WHERE telegram_id = ?', [ctx.from.id], (err, row) => {
            if (err) {
                console.error('Error checking user in DB:', err);
                return next(); // Continue processing even if DB error occurs
            }
            if (!row) {
                // If user doesn't exist, insert them into the users table
                db.run('INSERT INTO users (telegram_id) VALUES (?)', [ctx.from.id], (err) => {
                    if (err) console.error('Error inserting new user into DB:', err);
                    next();
                });
            } else {
                next(); // User exists, proceed to next middleware/handler
            }
        });
    } else {
        next(); // No user info, proceed
    }
});


// --- Reusable Logic Functions for Signals and Subscription Info ---

/**
 * Handles the logic for giving a signal.
 * @param {Object} ctx - The Telegraf context object.
 */
async function handleGiveSignal(ctx) {
    const telegramId = ctx.from.id;

    db.get('SELECT u.current_key_id, u.last_signal_timestamp, u.signal_count_hourly, ak.expires_at FROM users u LEFT JOIN access_keys ak ON u.current_key_id = ak.id WHERE u.telegram_id = ?', [telegramId], async (err, user) => {
        if (err) {
            console.error('Error fetching user for signal:', err);
            return ctx.reply('An error occurred. Please try again later.');
        }

        if (!user || !user.current_key_id) {
            return ctx.reply('You do not have an active access key. Please enter it.', expiredKeyKeyboard);
        }

        // Check key expiration
        if (user.expires_at && new Date(user.expires_at) < new Date()) {
            db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [user.current_key_id]);
            db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId]);
            return ctx.reply('Your access key has expired. Please enter a new key or contact the administrator.', expiredKeyKeyboard);
        }

        // Rate Limiting Logic
        const now = new Date();
        let lastSignalTime = user.last_signal_timestamp ? new Date(user.last_signal_timestamp) : null;
        let signalCount = user.signal_count_hourly;

        if (!lastSignalTime || (now.getTime() - lastSignalTime.getTime()) > 3600000) { // 1 hour in milliseconds
            signalCount = 1; // Reset count for new hour
            lastSignalTime = now;
        } else {
            signalCount++; // Increment count within the hour
        }

        if (signalCount > HOURLY_SIGNAL_LIMIT) {
            return ctx.reply(`You have exceeded the signal limit (${HOURLY_SIGNAL_LIMIT} per hour). Please try again later.`);
        }

        // Update rate limit in DB
        db.run('UPDATE users SET last_signal_timestamp = ?, signal_count_hourly = ? WHERE telegram_id = ?',
            [lastSignalTime.toISOString(), signalCount, telegramId], (updateErr) => {
                if (updateErr) console.error('Error updating rate limit:', updateErr);
            });

        // --- NEW: Send "generating" message and add delay ---
        await ctx.reply('Generating signal... Please wait a moment.');

        // Add a delay (e.g., 1.5 seconds)
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1500 milliseconds = 1.5 seconds

        // Generate Signal details
        const levels = ['Easy', 'Medium', 'Hard', 'Expert'];
        const randomLevel = levels[Math.floor(Math.random() * levels.length)];
        // Generates a float between 1.00 and 15.00, formatted to two decimal places
        const randomBetAmount = (Math.random() * 14 + 1).toFixed(2);

        const signalText = `Level: ${randomLevel}\nBet Amount: ${randomBetAmount} EUR`;

        // Get a random image path from the 'images' folder
        const randomImagePath = getRandomImagePath(); // This is where we call the function

        if (randomImagePath) {
            // Send the photo from the local path with the generated caption
            await ctx.replyWithPhoto({ source: randomImagePath }, { caption: `Jumps ⬆️\n${signalText}` });
        } else {
            // Fallback if no images are found or an error occurred
            await ctx.reply(`Jumps ⬆️\n${signalText}\n\n(No image available)`);
        }
        // Always send the main keyboard after the signal for consistent UX
        await ctx.reply('You can use the buttons below:', mainKeyboard);
    });
}

/**
 * Handles the logic for showing subscription information.
 * @param {Object} ctx - The Telegraf context object.
 */
async function handleSubscriptionInfo(ctx) {
    const telegramId = ctx.from.id;

    db.get('SELECT u.current_key_id, ak.expires_at FROM users u LEFT JOIN access_keys ak ON u.current_key_id = ak.id WHERE u.telegram_id = ?', [telegramId], async (err, user) => {
        if (err) {
            console.error('Error fetching subscription info:', err);
            return ctx.reply('An error occurred while fetching your subscription info. Please try again later.');
        }

        // Added expiredKeyKeyboard here
        if (!user || !user.current_key_id) {
            return ctx.reply('You currently do not have an active subscription. Please activate an access key to get one.', expiredKeyKeyboard);
        }

        if (user.expires_at) {
            const expiryDate = new Date(user.expires_at);
            const now = new Date();
            if (expiryDate < now) {
                // Key has expired, update DB
                db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [user.current_key_id]);
                db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId]);
                // Added expiredKeyKeyboard here
                return ctx.reply('Your subscription has expired. Please activate a new access key.', expiredKeyKeyboard);
            } else {
                return ctx.reply(`Your subscription is active!\nIt expires on: ${expiryDate.toLocaleString()}`, mainKeyboard);
            }
        } else {
            return ctx.reply('Your subscription is active!\nIt is set to never expire (lifetime access).', mainKeyboard);
        }
    });
}


// --- Bot Commands ---

// Handles the /start command
bot.start(async (ctx) => {
    // Added expiredKeyKeyboard here to the initial message
    await ctx.reply('Hello! I am your game hints bot. To get access to signals, please enter your unique access key.', expiredKeyKeyboard);
    // Check if user has an active key to show the main keyboard immediately
    db.get('SELECT current_key_id FROM users WHERE telegram_id = ?', [ctx.from.id], async (err, user) => {
        if (!err && user && user.current_key_id) {
            await ctx.reply('You can now use the following options:', mainKeyboard);
            await ctx.reply('You can also use the commands: /give_signal and /subscription_info directly from the Telegram menu.');
        }
    });
});

// Admin command to generate a key
// Accessible only by users whose IDs are in ADMIN_IDS
bot.command('generate_key', async (ctx) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
        return ctx.reply('You do not have permission to use this command.');
    }

    const args = ctx.message.text.split(' ').slice(1);
    const duration = args[0]; // e.g., 'week', 'month', 'forever'

    if (!['week', 'month', 'forever'].includes(duration)) {
        return ctx.reply('Incorrect format. Use: /generate_key [week|month|forever]');
    }

    const newKey = generateUniqueKey();
    const expiresAt = calculateExpiryDate(duration);

    db.run('INSERT INTO access_keys (key_value, expires_at, created_by_admin_id) VALUES (?, ?, ?)',
        [newKey, expiresAt, ctx.from.id], function(err) { // Using function keyword for `this.lastID`
            if (err) {
                console.error('Error generating key:', err);
                return ctx.reply('Error generating key.');
            }
            ctx.reply(`New key generated: \`${newKey}\`\nExpires: ${expiresAt ? new Date(expiresAt).toLocaleString() : 'Never'}`,
                { parse_mode: 'Markdown' });
        });
});

// --- Command Handlers using the refactored functions ---
bot.command('give_signal', handleGiveSignal);
bot.command('subscription_info', handleSubscriptionInfo);

// Handles any incoming text message as a potential access key
bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text.trim();
    const telegramId = ctx.from.id;

    // Check if user is trying to activate a key
    db.get('SELECT u.current_key_id FROM users u WHERE u.telegram_id = ?', [telegramId], async (err, userRow) => {
        if (err) {
            console.error('Error checking user current key:', err);
            return ctx.reply('An error occurred. Please try again later.');
        }

        // If user already has an active key, don't process new key input directly
        if (userRow && userRow.current_key_id) {
            // Check if the current key is expired and prompt for a new one
            db.get('SELECT expires_at FROM access_keys WHERE id = ?', [userRow.current_key_id], async (err, keyDetails) => {
                if (err) {
                    console.error('Error checking key expiry:', err);
                    return ctx.reply('An error occurred. Please try again later.');
                }
                if (keyDetails && keyDetails.expires_at && new Date(keyDetails.expires_at) < new Date()) {
                    // Key expired, clean up and allow new key input
                    db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [userRow.current_key_id]);
                    db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId], async (err) => {
                        if (err) console.error('Error nulling expired key:', err);
                        // Added expiredKeyKeyboard here as well
                        return ctx.reply('Your access key has expired. Please enter a new key or contact the administrator.', expiredKeyKeyboard);
                    });
                } else {
                    return ctx.reply('You already have an active access key. You can use the buttons below:', mainKeyboard);
                }
            });
        } else {
            // User does not have an active key, process potential new key
            db.get('SELECT * FROM access_keys WHERE key_value = ? AND is_active = TRUE AND user_id IS NULL', [userMessage], async (err, keyRow) => {
                if (err) {
                    console.error('Error checking key:', err);
                    return ctx.reply('An error occurred while checking the key. Please try again later.');
                }

                if (keyRow) {
                    // Check if key has expired
                    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
                        db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [keyRow.id]);
                        // Added expiredKeyKeyboard here
                        return ctx.reply('This key is no longer valid.', expiredKeyKeyboard);
                    }

                    // Claim the key
                    db.run('UPDATE access_keys SET user_id = ?, is_active = TRUE WHERE id = ?', [telegramId, keyRow.id], (err) => {
                        if (err) {
                            console.error('Error claiming key:', err);
                            return ctx.reply('Failed to activate the key. It might already be in use.');
                        }
                        db.run('UPDATE users SET current_key_id = ? WHERE telegram_id = ?', [keyRow.id, telegramId], async (err) => {
                            if (err) {
                                console.error('Error linking key to user:', err);
                                return ctx.reply('An internal error occurred. Please contact the administrator.');
                            }
                            await ctx.reply('Key successfully activated! You can now receive signals.', mainKeyboard);
                        });
                    });
                } else {
                    await ctx.reply('Invalid key or it has already been used. Please enter a valid unique key.');
                }
            });
        }
    });
});

// --- Callback Query Handlers using the refactored functions ---
bot.action('give_signal', handleGiveSignal);
bot.action('subscription_info', handleSubscriptionInfo);


// Start the bot
bot.launch();
console.log('Bot started');

// Enable graceful stop on SIGINT (Ctrl+C) and SIGTERM
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    db.close((err) => { // Close database connection on exit
        if (err) console.error('Error closing database:', err.message);
        console.log('Database connection closed.');
    });
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    db.close((err) => { // Close database connection on exit
        if (err) console.error('Error closing database:', err.message);
        console.log('Database connection closed.');
    });
});