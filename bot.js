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
            signal_count_daily INTEGER DEFAULT 0,
            language_code TEXT,
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
const ADMIN_IDS = [7263932570, 987654321]; // IMPORTANT: Replace with your actual admin IDs!
const DAILY_SIGNAL_LIMIT = 100;

const IMAGES_BASE_DIR = path.resolve(__dirname, 'images'); // Базова директорія для зображень

// --- Multilingual Phrases ---
const phrases = {
    'it': {
        start_welcome_initial_prompt: 'Ciao! Benvenuto. Per favor, scegli la tua lingua per continuare:',
        start_welcome: 'Ciao! Sono il tuo bot per i suggerimenti di gioco. Per accedere ai segnali, inserisci la tua chiave di accesso unica.',
        start_has_key: 'Puoi usare le seguenti opzioni:',
        main_menu_button_signal: 'Dai Segnale',
        main_menu_button_subscription: 'Info Abbonamento',
        main_menu_button_change_lang: 'Cambia Lingua',
        generating_signal: 'Generazione segnale in corso... Attendere prego.',
        error_general: 'Si è verificato un errore. Riprova più tardi.',
        no_active_key: 'Non hai una chiave di accesso attiva. Inseriscila.',
        key_expired: 'La tua chiave di accesso è scaduta. Inserisci una nuova chiave o contatta l\'amministratore.',
        limit_exceeded: 'Hai superato il limite di segnali giornalieri ({{limit}} al giorno). Riprova più tardi.',
        contact_admin_button: 'Contatta l\'Amministratore',
        subscription_no_active: 'Attualmente non hai un abbonamento attivo. Attiva una chiave di accesso per ottenerne uno.',
        subscription_active_expires: 'Il tuo abbonamento è attivo!\nScade il: {{expiryDate}}',
        subscription_active_lifetime: 'Nessuna scadenza (accesso a vita).',
        invalid_key_or_used: 'Chiave non valida o già utilizzata. Inserisci una chiave unica valida.',
        key_activated: 'Chiave attivata con successo! Ora puoi ricevere i segnali.',
        admin_no_permission: 'Non hai il permesso di usare questo comando.',
        admin_generate_key_format: 'Formato errato. Usa: /generate_key [2days|4days|week|month|forever]',
        admin_key_generated: 'Nuova chiave generata: `{{key}}`\nScade: {{expiresAt}}',
        admin_key_generated_never: 'Mai',
        change_lang_message: 'Per favor, scegli la tua lingua:',
        language_set: 'Lingua impostata su italiano.',
        commands_info: 'Puoi anche usare i comandi: /give_signal e /subscription_info direttamente dal menu di Telegram.',
        key_invalid_not_active: 'Questa chiave non è più valida.',
        please_choose_language: 'Per favor, scegli la tua lingua per continuare.',
        signal_message_format: '🟢 BET\n🔥 {{steps}} PASSAGGI DI CASSA AUTOMATICA\n✨ Livello: {{level}}',
        level_easy: 'Facile',
        level_medium: 'Medio',
        level_hard: 'Difficile',
        level_extra_hard: 'Extra Difficile',
    },
    'de': {
        start_welcome_initial_prompt: 'Hallo! Willkommen. Bitte wählen Sie Ihre Sprache, um fortzufahren:',
        start_welcome: 'Hallo! Ich bin dein Spielhinweis-Bot. Um Zugriff auf Signale zu erhalten, gib bitte deinen eindeutigen Zugangsschlüssel ein.',
        start_has_key: 'Du kannst die folgenden Optionen verwenden:',
        main_menu_button_signal: 'Signal geben',
        main_menu_button_subscription: 'Abonnement-Info',
        main_menu_button_change_lang: 'Sprache ändern',
        generating_signal: 'Signal wird generiert... Bitte warten Sie einen Moment.',
        error_general: 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.',
        no_active_key: 'Du hast keinen aktiven Zugangsschlüssel. Bitte gib ihn ein.',
        key_expired: 'Dein Zugangsschlüssel ist abgelaufen. Bitte gib einen neuen Schlüssel ein oder kontaktiere den Administrator.',
        limit_exceeded: 'Du hast das tägliche Signallimit ({{limit}} pro Tag) überschritten. Bitte versuche es später erneut.',
        contact_admin_button: 'Admin kontaktieren',
        subscription_no_active: 'Du hast derzeit kein aktives Abonnement. Bitte aktiviere einen Zugangsschlüssel, um eines zu erhalten.',
        subscription_active_expires: 'Dein Abonnement ist aktiv!\nEs läuft ab am: {{expiryDate}}',
        subscription_active_lifetime: 'Kein Ablaufdatum (lebenslanger Zugriff).',
        invalid_key_or_used: 'Ungültiger Schlüssel oder bereits verwendet. Bitte gib einen gültigen, eindeutigen Schlüssel ein.',
        key_activated: 'Schlüssel erfolgreich aktiviert! Du kannst jetzt Signale empfangen.',
        admin_no_permission: 'Du hast keine Berechtigung, diesen Befehl zu verwenden.',
        admin_generate_key_format: 'Falsches Format. Verwende: /generate_key [2days|4days|week|month|forever]',
        admin_key_generated: 'Neuer Schlüssel generiert: `{{key}}`\nLäuft ab: {{expiresAt}}',
        admin_key_generated_never: 'Nie',
        change_lang_message: 'Bitte wählen Sie Ihre Sprache:',
        language_set: 'Sprache auf Deutsch geändert.',
        commands_info: 'Du kannst auch die Befehle: /give_signal und /subscription_info direkt über das Telegram-Menü verwenden.',
        key_invalid_not_active: 'Dieser Schlüssel ist nicht mehr gültig.',
        please_choose_language: 'Bitte wählen Sie Ihre Sprache, um fortzufahren.',
        signal_message_format: '🟢 BET\n🔥 {{steps}} SCHRITTE AUTO CASH OUT\n✨ Level: {{level}}',
        level_easy: 'Leicht',
        level_medium: 'Mittel',
        level_hard: 'Schwer',
        level_extra_hard: 'Extra Schwer',
    },
    'fr': {
        start_welcome_initial_prompt: 'Bonjour! Bienvenue. Veuillez choisir votre langue pour continuer :',
        start_welcome: 'Bonjour! Je suis votre bot d\'indices de jeu. Pour accéder aux signaux, veuillez entrer votre clé d\'accès unique.',
        start_has_key: 'Vous pouvez utiliser les options suivantes :',
        main_menu_button_signal: 'Donner un Signal',
        main_menu_button_subscription: 'Infos Abonnement',
        main_menu_button_change_lang: 'Changer la Langue',
        generating_signal: 'Génération du signal... Veuillez patienter.',
        error_general: 'Une erreur est survenue. Veuillez réessayer plus tard.',
        no_active_key: 'Vous n\'avez pas de clé d\'accès active. Veuillez l\'entrer.',
        key_expired: 'Votre clé d\'accès a expiré. Veuillez entrer une nouvelle clé ou contacter l\'administrateur.',
        limit_exceeded: 'Vous avez dépassé la limite de signaux quotidiens ({{limit}} par jour). Veuillez réessayer plus tard.',
        contact_admin_button: 'Contacter l\'Administrateur',
        subscription_no_active: 'Vous n\'avez actuellement pas d\'abonnement actif. Veuillez activer une clé d\'accès pour en obtenir un.',
        subscription_active_expires: 'Votre abonnement est actif !\nExpire le : {{expiryDate}}',
        subscription_active_lifetime: 'Aucune expiration (accès à vie).',
        invalid_key_or_used: 'Clé invalide ou déjà utilisée. Veuillez entrer une clé unique valide.',
        key_activated: 'Clé activée avec succès ! Vous pouvez maintenant recevoir des signaux.',
        admin_no_permission: 'Vous n\'avez pas la permission d\'utiliser cette commande.',
        admin_generate_key_format: 'Format incorrect. Utilisez : /generate_key [2days|4days|week|month|forever]',
        admin_key_generated: 'Nouvelle clé générée : `{{key}}`\nExpire : {{expiresAt}}',
        admin_key_generated_never: 'Jamais',
        change_lang_message: 'Veuillez choisir votre langue :',
        language_set: 'Langue définie sur le français.',
        commands_info: 'Vous pouvez également utiliser les commandes : /give_signal et /subscription_info directement depuis le menu Telegram.',
        key_invalid_not_active: 'Cette clé n\'est plus valide.',
        please_choose_language: 'Veuillez choisir votre langue pour continuer.',
        signal_message_format: '🟢 BET\n🔥 {{steps}} ÉTAPES AUTO CASH OUT\n✨ Niveau: {{level}}',
        level_easy: 'Facile',
        level_medium: 'Moyen',
        level_hard: 'Difficile',
        level_extra_hard: 'Extra Difficile',
    }
};

/**
 * Helper function to get a translated phrase.
 * @param {string|null} lang The language code (e.g., 'it', 'de', 'fr'). Can be null if not set.
 * @param {string} key The key for the phrase.
 * @param {object} [replacements] Optional object with placeholders to replace.
 * @returns {string} The translated phrase. Returns a fallback or empty string if lang is null or key not found.
 */
function getPhrase(lang, key, replacements = {}) {
    let phrase = null;
    if (lang && phrases[lang] && phrases[lang][key]) {
        phrase = phrases[lang][key];
    } else if (phrases['it'] && phrases['it'][key]) { // Fallback to Italian if selected lang or key not found
        phrase = phrases['it'][key];
    } else {
        console.warn(`Missing phrase for key "${key}" in language "${lang || 'null'}" and no Italian fallback.`);
        return `[Missing phrase: ${key}]`; // Or an empty string, or a generic error message
    }

    for (const placeholder in replacements) {
        phrase = phrase.replace(`{{${placeholder}}}`, replacements[placeholder]);
    }
    return phrase;
}


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
 * @param {string} duration - The duration string ('2days', '4days', 'week', 'month', 'forever').
 * @returns {string|null} The expiry date in ISO 8601 format, or null if 'forever' or invalid duration.
*/
function calculateExpiryDate(duration) {
    const now = new Date();
    let expiryDate = null;
    switch (duration) {
        case '2days':
            expiryDate = new Date(now.setDate(now.getDate() + 2));
            break;
        case '4days':
            expiryDate = new Date(now.setDate(now.getDate() + 4));
            break;
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
 * Gets the specific image file path for a given number of steps and language.
 * Checks for .png extension.
 * @param {string} lang The language code (e.g., 'it', 'de', 'fr').
 * @param {number} steps The number of steps to find the image for.
 * @returns {string|null} The full path to the specific image, or null if not found.
 */
function getSpecificImagePathForSteps(lang, steps) {
    const langImagesDir = path.join(IMAGES_BASE_DIR, lang);
    const imagePath = path.join(langImagesDir, `${steps}.png`); // Припускаємо, що всі зображення мають розширення .png

    console.log(`Attempting to find image: ${imagePath}`);

    if (fs.existsSync(imagePath)) {
        return imagePath;
    } else {
        console.warn(`Image for steps ${steps} not found for language '${lang}': ${imagePath}`);
        return null; // Зображення не знайдено
    }
}


// --- Keyboard Markup for common user actions ---
// mainKeyboard now depends on the user's language
function generateMainKeyboard(lang) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(getPhrase(lang, 'main_menu_button_signal'), 'give_signal'),
            Markup.button.callback(getPhrase(lang, 'main_menu_button_subscription'), 'subscription_info')
        ],
        [
            Markup.button.callback(getPhrase(lang, 'main_menu_button_change_lang'), 'change_language')
        ]
    ]);
}

// expiredKeyKeyboard also depends on the user's language
function generateExpiredKeyKeyboard(lang) {
    return Markup.inlineKeyboard([
        Markup.button.url(getPhrase(lang, 'contact_admin_button'), 'https://t.me/HANS_LANDA1')
    ]);
}

// Keyboard for language selection
const setLanguageKeyboard = Markup.inlineKeyboard([
    Markup.button.callback('Italiano', 'set_lang_it'),
    Markup.button.callback('Deutsch', 'set_lang_de'),
    Markup.button.callback('Français', 'set_lang_fr'),
]);


// --- Middleware to check if user exists in DB, load language, and enforce language selection ---
bot.use(async (ctx, next) => {
    if (!ctx.from) { // No user info, proceed (e.g. channel post)
        ctx.state.lang = 'it'; // Default fallback for system messages, not user interactions
        return next();
    }

    db.get('SELECT * FROM users WHERE telegram_id = ?', [ctx.from.id], (err, row) => {
        if (err) {
            console.error('Error checking user in DB:', err);
            ctx.state.lang = 'it'; // Default fallback on DB error
            return next();
        }

        if (!row) {
            // New user, insert them with NULL language_code
            db.run('INSERT INTO users (telegram_id, language_code) VALUES (?, NULL)', [ctx.from.id], (err) => {
                if (err) console.error('Error inserting new user into DB:', err);
                ctx.state.lang = null; // Mark language as not set
                // For new users, ensure they are routed to language selection
                if (ctx.message && ctx.message.text !== '/start' && (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('set_lang_'))) {
                     // If it's not a start command or language selection, prompt
                    ctx.reply("Please choose your language to continue.", setLanguageKeyboard);
                    return; // Stop processing this update
                }
                next();
            });
        } else {
            ctx.state.lang = row.language_code; // Load user's language (can be NULL)

            // If language is not set and it's not a language selection action or /start
            if (!ctx.state.lang && (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('set_lang_')) && (!ctx.message || ctx.message.text !== '/start')) {
                // If the bot tries to send a reply without language set yet, it will error.
                // We must intercept and send the language prompt.
                ctx.reply("Please choose your language to continue.", setLanguageKeyboard);
                return; // Stop processing this update
            }
            next(); // User exists, proceed to next middleware/handler
        }
    });
});


// --- Reusable Logic Functions for Signals and Subscription Info ---

/**
 * Handles the logic for giving a signal.
 * @param {Object} ctx - The Telegraf context object.
 */
async function handleGiveSignal(ctx) {
    const telegramId = ctx.from.id;
    const lang = ctx.state.lang;

    // IMPORTANT: Ensure language is set before proceeding
    if (!lang) {
        return ctx.reply(getPhrase('it', 'please_choose_language'), setLanguageKeyboard);
    }

    db.get('SELECT u.current_key_id, u.last_signal_timestamp, u.signal_count_daily, ak.expires_at FROM users u LEFT JOIN access_keys ak ON u.current_key_id = ak.id WHERE u.telegram_id = ?', [telegramId], async (err, user) => {
        if (err) {
            console.error('Error fetching user for signal:', err);
            return ctx.reply(getPhrase(lang, 'error_general'));
        }

        if (!user || !user.current_key_id) {
            return ctx.reply(getPhrase(lang, 'no_active_key'), generateExpiredKeyKeyboard(lang));
        }

        // Check key expiration
        if (user.expires_at && new Date(user.expires_at) < new Date()) {
            db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [user.current_key_id]);
            db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId]);
            return ctx.reply(getPhrase(lang, 'key_expired'), generateExpiredKeyKeyboard(lang));
        }

        // Daily Rate Limiting Logic
        const now = new Date();
        const lastSignalTime = user.last_signal_timestamp ? new Date(user.last_signal_timestamp) : null;
        let signalCount = user.signal_count_daily;

        const startOfTodayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).getTime();
        const startOfLastSignalDayUTC = lastSignalTime ? new Date(Date.UTC(lastSignalTime.getFullYear(), lastSignalTime.getMonth(), lastSignalTime.getDate())).getTime() : 0;

        if (!lastSignalTime || startOfLastSignalDayUTC < startOfTodayUTC) {
            signalCount = 1;
        } else {
            signalCount++;
        }

        if (signalCount > DAILY_SIGNAL_LIMIT) {
            return ctx.reply(getPhrase(lang, 'limit_exceeded', { limit: DAILY_SIGNAL_LIMIT }));
        }

        // Update rate limit in DB
        db.run('UPDATE users SET last_signal_timestamp = ?, signal_count_daily = ? WHERE telegram_id = ?',
            [now.toISOString(), signalCount, telegramId], (updateErr) => {
                if (updateErr) console.error('Error updating rate limit:', updateErr);
            });

        await ctx.reply(getPhrase(lang, 'generating_signal'));
        await new Promise(resolve => setTimeout(resolve, 1500));

        // --- Modified Logic for Levels and Steps (Weighted Random Selection) ---
        // 'easy' and 'medium' are more frequent
        const weightedLevels = [
            'easy', 'easy', 'easy', 'easy', 'easy',
            'medium', 'medium', 'medium', 'medium',
            'hard',
            'extra_hard'
        ];
        // Now 'easy' is 5x, 'medium' is 4x, 'hard' is 1x, 'extra_hard' is 1x.
        // Adjust array contents to change frequency.

        const randomLevelKey = weightedLevels[Math.floor(Math.random() * weightedLevels.length)];
        const translatedLevel = getPhrase(lang, `level_${randomLevelKey}`);

        let minSteps, maxSteps;
        switch (randomLevelKey) {
            case 'easy':
                minSteps = 10;
                maxSteps = 30;
                break;
            case 'medium':
                minSteps = 5;
                maxSteps = 9;
                break;
            case 'hard':
                minSteps = 1;
                maxSteps = 4;
                break;
            case 'extra_hard':
                minSteps = 1;
                maxSteps = 3;
                break;
            default: // Should not happen, but good for safety
                minSteps = 5;
                maxSteps = 9;
        }

        const randomSteps = Math.floor(Math.random() * (maxSteps - minSteps + 1)) + minSteps;

        const fullSignalMessage = getPhrase(lang, 'signal_message_format', {
            steps: randomSteps,
            level: translatedLevel
        });

        // --- Use the new function to get the specific image for steps ---
        const specificImagePath = getSpecificImagePathForSteps(lang, randomSteps);

        if (specificImagePath) {
            await ctx.replyWithPhoto({ source: specificImagePath }, { caption: fullSignalMessage });
        } else {
            // Fallback to sending only text if the specific image is not found
            await ctx.reply(fullSignalMessage);
        }
        await ctx.reply(getPhrase(lang, 'start_has_key'), generateMainKeyboard(lang));
    });
}

/**
 * Handles the logic for showing subscription information.
 * @param {Object} ctx - The Telegraf context object.
 */
async function handleSubscriptionInfo(ctx) {
    const telegramId = ctx.from.id;
    const lang = ctx.state.lang;

    // IMPORTANT: Ensure language is set before proceeding
    if (!lang) {
        return ctx.reply(getPhrase('it', 'please_choose_language'), setLanguageKeyboard);
    }

    db.get('SELECT u.current_key_id, ak.expires_at FROM users u LEFT JOIN access_keys ak ON u.current_key_id = ak.id WHERE u.telegram_id = ?', [telegramId], async (err, user) => {
        if (err) {
            console.error('Error fetching subscription info:', err);
            return ctx.reply(getPhrase(lang, 'error_general'));
        }

        if (!user || !user.current_key_id) {
            return ctx.reply(getPhrase(lang, 'subscription_no_active'), generateExpiredKeyKeyboard(lang));
        }

        if (user.expires_at) {
            const expiryDate = new Date(user.expires_at);
            const now = new Date();
            if (expiryDate < now) {
                db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [user.current_key_id]);
                db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId]);
                return ctx.reply(getPhrase(lang, 'key_expired'), generateExpiredKeyKeyboard(lang));
            } else {
                return ctx.reply(getPhrase(lang, 'subscription_active_expires', { expiryDate: expiryDate.toLocaleString(lang) }), generateMainKeyboard(lang));
            }
        } else {
            return ctx.reply(getPhrase(lang, 'subscription_active_lifetime'), generateMainKeyboard(lang));
        }
    });
}


// --- Bot Commands ---

// Handles the /start command
bot.start(async (ctx) => {
    const lang = ctx.state.lang;

    if (!lang) {
        await ctx.reply("Please choose your language to continue:", setLanguageKeyboard);
    } else {
        // Перевіряємо, чи є у користувача активний ключ при старті
        db.get('SELECT u.current_key_id, ak.expires_at FROM users u LEFT JOIN access_keys ak ON u.current_key_id = ak.id WHERE u.telegram_id = ?', [ctx.from.id], async (err, userKeyInfo) => {
            if (err) {
                console.error('Error fetching user key info on start:', err);
                return ctx.reply(getPhrase(lang, 'error_general'));
            }

            let hasActiveKey = false;
            if (userKeyInfo && userKeyInfo.current_key_id) {
                if (userKeyInfo.expires_at && new Date(userKeyInfo.expires_at) < new Date()) {
                    db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [userKeyInfo.current_key_id]);
                    db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [ctx.from.id], (updateErr) => {
                        if (updateErr) console.error('Error clearing expired key from user on start:', updateErr);
                    });
                } else {
                    hasActiveKey = true;
                }
            }

            if (hasActiveKey) {
                await ctx.reply(getPhrase(lang, 'start_has_key'), generateMainKeyboard(lang));
                await ctx.reply(getPhrase(lang, 'commands_info'));
            } else {
                await ctx.reply(getPhrase(lang, 'start_welcome'), generateExpiredKeyKeyboard(lang));
            }
        });
    }
});

// Admin command to generate a key
// Accessible only by users whose IDs are in ADMIN_IDS
bot.command('generate_key', async (ctx) => {
    const lang = ctx.state.lang;

    if (!lang) {
        return ctx.reply(getPhrase('it', 'please_choose_language'), setLanguageKeyboard);
    }

    if (!ADMIN_IDS.includes(ctx.from.id)) {
        return ctx.reply(getPhrase(lang, 'admin_no_permission'));
    }

    const args = ctx.message.text.split(' ').slice(1);
    const duration = args[0];

    if (!['2days', '4days', 'week', 'month', 'forever'].includes(duration)) {
        return ctx.reply(getPhrase(lang, 'admin_generate_key_format'));
    }

    const newKey = generateUniqueKey();
    const expiresAt = calculateExpiryDate(duration);

    db.run('INSERT INTO access_keys (key_value, expires_at, created_by_admin_id) VALUES (?, ?, ?)',
        [newKey, expiresAt, ctx.from.id], function(err) {
            if (err) {
                console.error('Error generating key:', err);
                return ctx.reply(getPhrase(lang, 'error_general'));
            }
            const expiryText = expiresAt ? new Date(expiresAt).toLocaleString(lang) : getPhrase(lang, 'admin_key_generated_never');
            ctx.reply(getPhrase(lang, 'admin_key_generated', { key: newKey, expiresAt: expiryText }),
                { parse_mode: 'Markdown' });
        });
});

// Admin command to generate an EXPIRED key for testing purposes
bot.command('generate_expired_key', async (ctx) => {
    const lang = ctx.state.lang;

    if (!lang) {
        return ctx.reply(getPhrase('it', 'please_choose_language'), setLanguageKeyboard);
    }

    if (!ADMIN_IDS.includes(ctx.from.id)) {
        return ctx.reply(getPhrase(lang, 'admin_no_permission'));
    }

    const newKey = generateUniqueKey();
    // Use a fixed past date for expiry for testing
    const expiredAt = '2025-06-10T10:00:00.000Z'; // This date is clearly in the past

    db.run('INSERT INTO access_keys (key_value, expires_at, created_by_admin_id) VALUES (?, ?, ?)',
        [newKey, expiredAt, ctx.from.id], function(err) {
            if (err) {
                console.error('Error generating expired key:', err);
                return ctx.reply(getPhrase(lang, 'error_general'));
            }
            ctx.reply(`Створено закінчений ключ для тестування: \`${newKey}\`\nТермін дії: ${expiredAt}`);
            ctx.reply('Будь ласка, використовуйте цей ключ для тестування сценарію закінчення терміну дії.');
        });
});


// --- Command Handlers using the refactored functions ---
bot.command('give_signal', handleGiveSignal);
bot.command('subscription_info', handleSubscriptionInfo);

// Handler for the "Change Language" button
bot.action('change_language', async (ctx) => {
    const lang = ctx.state.lang;
    if (!lang) {
        return ctx.reply(getPhrase('it', 'please_choose_language'), setLanguageKeyboard);
    }
    await ctx.editMessageText(getPhrase(lang, 'change_lang_message'), setLanguageKeyboard);
    await ctx.answerCbQuery();
});

// Handlers for language selection callbacks
bot.action(/set_lang_(it|de|fr)/, async (ctx) => {
    const newLang = ctx.match[1];
    const telegramId = ctx.from.id;

    db.run('UPDATE users SET language_code = ? WHERE telegram_id = ?', [newLang, telegramId], async (err) => {
        if (err) {
            console.error('Error setting language:', err);
            return ctx.reply(getPhrase(newLang, 'error_general'), generateMainKeyboard(newLang));
        }
        ctx.state.lang = newLang; // Оновлюємо мову в стані контексту

        // 1. Повідомляємо про успішну зміну мови
        await ctx.editMessageText(getPhrase(newLang, 'language_set'));
        await ctx.answerCbQuery(); // Відповідаємо на callback-запит

        // 2. Тепер перевіряємо, чи є у користувача активний ключ
        db.get('SELECT u.current_key_id, ak.expires_at FROM users u LEFT JOIN access_keys ak ON u.current_key_id = ak.id WHERE u.telegram_id = ?', [telegramId], async (err, userKeyInfo) => {
            if (err) {
                console.error('Error fetching user key info after lang change:', err);
                return ctx.reply(getPhrase(newLang, 'error_general'), generateMainKeyboard(newLang));
            }

            let hasActiveKey = false;
            if (userKeyInfo && userKeyInfo.current_key_id) {
                // Перевіряємо термін дії ключа
                if (userKeyInfo.expires_at && new Date(userKeyInfo.expires_at) < new Date()) {
                    // Ключ прострочений, оновлюємо статус в БД
                    db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [userKeyInfo.current_key_id]);
                    db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId], (updateErr) => {
                        if (updateErr) console.error('Error clearing expired key from user:', updateErr);
                    });
                    // Ключ прострочений, тому hasActiveKey залишається false
                } else {
                    hasActiveKey = true; // Ключ активний і не прострочений
                }
            }

            if (hasActiveKey) {
                // Якщо є активний ключ, показуємо основне меню
                await ctx.reply(getPhrase(newLang, 'start_has_key'), generateMainKeyboard(newLang));
            } else {
                // Якщо немає активного ключа (або він прострочений), просимо ввести ключ
                await ctx.reply(getPhrase(newLang, 'start_welcome'), generateExpiredKeyKeyboard(newLang));
            }
            // Додатково, якщо є активний ключ, можна надіслати інформацію про команди
            if (hasActiveKey) {
                await ctx.reply(getPhrase(newLang, 'commands_info'));
            }
        });
    });
});


// Handles any incoming text message as a potential access key
bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text.trim();
    const telegramId = ctx.from.id;
    const lang = ctx.state.lang;

    if (!lang) {
        return ctx.reply(getPhrase('it', 'please_choose_language'), setLanguageKeyboard);
    }

    db.get('SELECT u.current_key_id FROM users u WHERE u.telegram_id = ?', [telegramId], async (err, userRow) => {
        if (err) {
            console.error('Error checking user current key:', err);
            return ctx.reply(getPhrase(lang, 'error_general'));
        }

        if (userRow && userRow.current_key_id) {
            db.get('SELECT expires_at FROM access_keys WHERE id = ?', [userRow.current_key_id], async (err, keyDetails) => {
                if (err) {
                    console.error('Error checking key expiry:', err);
                    return ctx.reply(getPhrase(lang, 'error_general'));
                }
                if (keyDetails && keyDetails.expires_at && new Date(keyDetails.expires_at) < new Date()) {
                    db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [userRow.current_key_id]);
                    db.run('UPDATE users SET current_key_id = NULL WHERE telegram_id = ?', [telegramId], async (err) => {
                        if (err) console.error('Error nulling expired key:', err);
                        return ctx.reply(getPhrase(lang, 'key_expired'), generateExpiredKeyKeyboard(lang));
                    });
                } else {
                    // Якщо ключ дійсний, просто відображаємо головне меню та повідомлення про команди
                    await ctx.reply(getPhrase(lang, 'start_has_key'), generateMainKeyboard(lang));
                    await ctx.reply(getPhrase(lang, 'commands_info'));
                }
            });
        } else {
            // Користувач не має активного ключа, перевіряємо введений текст як ключ
            db.get('SELECT * FROM access_keys WHERE key_value = ? AND is_active = TRUE AND user_id IS NULL', [userMessage], async (err, keyRow) => {
                if (err) {
                    console.error('Error checking key:', err);
                    return ctx.reply(getPhrase(lang, 'error_general'));
                }

                if (keyRow) {
                    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
                        db.run('UPDATE access_keys SET is_active = FALSE WHERE id = ?', [keyRow.id]);
                        return ctx.reply(getPhrase(lang, 'key_invalid_not_active'), generateExpiredKeyKeyboard(lang));
                    }

                    db.run('UPDATE access_keys SET user_id = ?, is_active = TRUE WHERE id = ?', [telegramId, keyRow.id], (err) => {
                        if (err) {
                            console.error('Error claiming key:', err);
                            return ctx.reply(getPhrase(lang, 'error_general'));
                        }
                        db.run('UPDATE users SET current_key_id = ? WHERE telegram_id = ?', [keyRow.id, telegramId], async (err) => {
                            if (err) {
                                console.error('Error linking key to user:', err);
                                return ctx.reply(getPhrase(lang, 'error_general'));
                            }
                            await ctx.reply(getPhrase(lang, 'key_activated'), generateMainKeyboard(lang));
                            await ctx.reply(getPhrase(lang, 'commands_info')); // Відправляємо інфо про команди після активації
                        });
                    });
                } else {
                    await ctx.reply(getPhrase(lang, 'invalid_key_or_used'));
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
    db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        console.log('Database connection closed.');
    });
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        console.log('Database connection closed.');
    });
});